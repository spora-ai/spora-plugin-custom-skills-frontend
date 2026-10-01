/**
 * `SkillDesk` — the writing surface.
 *
 * The invariant the whole component exists to hold: **`SKILL.md` is always in the
 * rail and cannot be removed.** The contract synthesises that path on read, so a
 * rail that could be emptied, or a body that could be opened blank, would be a
 * state the server does not have.
 *
 * The other two load-bearing behaviours: the size readout is in bytes against the
 * contract's per-file cap, and a rejection (422 `SKILL_INVALID`) puts an error
 * under the field its `path` names, with warnings and unattached errors in a
 * banner so nothing the validator said is dropped.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SkillDesk from '../../src/components/SkillDesk.vue'
import { makeSkill, makeValidationEntry } from '../fixtures'

function mountDesk(props: Record<string, unknown> = {}) {
    return mount(SkillDesk, { props: { skill: makeSkill(), ...props } })
}

describe('SkillDesk → the rail cannot be empty', () => {
    it('always offers SKILL.md, first and selected', () => {
        const wrapper = mountDesk()
        const rail = wrapper.get('[data-test="file-rail"]')
        expect(rail.findAll('[data-test="rail-entry"]')).toHaveLength(1)
        expect(rail.findAll('[data-test="rail-entry"]')[0]?.text()).toContain('SKILL.md')
        expect(rail.findAll('[data-test="rail-file"]')).toHaveLength(1)
    })

    it('offers SKILL.md even for a skill with no sidecars at all', () => {
        const wrapper = mountDesk({ skill: makeSkill({ files: [{ path: 'SKILL.md', bytes: 10 }] }) })
        expect(wrapper.findAll('[data-test="rail-entry"]')).toHaveLength(1)
        expect(wrapper.findAll('[data-test="rail-file"]')).toHaveLength(0)
    })

    it('gives SKILL.md no remove control, and only the sidecar one', async () => {
        const wrapper = mountDesk()
        // SKILL.md is the active file, so no sidecar is removable either.
        expect(wrapper.find('[data-test="remove-sidecar"]').exists()).toBe(false)

        await wrapper.findAll('[data-test="rail-file"]')[0]?.trigger('click')
        const remove = wrapper.get('[data-test="remove-sidecar"]')
        expect(remove.text()).toContain('examples/invoice.md')
    })

    it('says why the rail cannot be emptied', () => {
        expect(mountDesk().get('[data-test="file-rail"]').text()).toContain('Every skill has a')
    })
})

describe('SkillDesk → the header', () => {
    it('shows the name and locks it', () => {
        const wrapper = mountDesk()
        expect(wrapper.get('[data-test="desk-title"]').text()).toBe('invoice-drafting')
        // The contract rejects a rename with 422, so there is no name input to
        // offer here at all.
        expect(wrapper.find('[data-test="field-name"]').exists()).toBe(false)
        expect(wrapper.get('[data-test="desk-name-lock"]').attributes('title')).toContain('cannot be changed')
    })

    it('opens "saved", and says "unsaved changes" only once the buffer diverges', async () => {
        const wrapper = mountDesk()
        expect(wrapper.get('[data-test="desk-state"]').text()).toBe('saved')
        expect(wrapper.get('[data-test="desk-save"]').attributes('disabled')).toBeDefined()

        await wrapper.get('[data-testid="md-editor-stub"]').setValue('# Rewritten')
        expect(wrapper.get('[data-test="desk-state"]').text()).toBe('unsaved changes')
        expect(wrapper.get('[data-test="desk-save"]').attributes('disabled')).toBeUndefined()
    })

    it('offers restore only when the server holds a previous snapshot', () => {
        expect(mountDesk().find('[data-test="desk-restore"]').exists()).toBe(true)
        expect(mountDesk({ skill: makeSkill({ has_previous: false }) })
            .find('[data-test="desk-restore"]').exists()).toBe(false)
    })

    it('emits the name for restore, cancel and delete', async () => {
        const wrapper = mountDesk()
        await wrapper.get('[data-test="desk-restore"]').trigger('click')
        await wrapper.get('[data-test="desk-cancel"]').trigger('click')
        // Delete is behind the menu, so the trigger is part of the interaction.
        await wrapper.get('[data-test="desk-menu-trigger"]').trigger('click')
        await wrapper.get('[data-test="desk-delete"]').trigger('click')
        expect(wrapper.emitted('restore')?.[0]).toEqual(['invoice-drafting'])
        expect(wrapper.emitted('cancel')).toHaveLength(1)
        expect(wrapper.emitted('delete')?.[0]).toEqual(['invoice-drafting'])
    })

    it('puts exactly one delete on screen, so the two are never confused', async () => {
        // Removing a sidecar and deleting the skill were both a bare trash icon
        // ~30px apart with the same shape. The worst case is a sidecar selected:
        // its remove appears, directly under the skill's delete.
        const wrapper = mountDesk({
            skill: makeSkill({ files: [{ path: 'SKILL.md', bytes: 10 }, { path: 'examples/a.md', bytes: 4 }] }),
        })
        await wrapper.findAll('[data-test="rail-file"]')[0]?.trigger('click')

        expect(wrapper.find('[data-test="desk-menu"]').exists(), 'the delete lives in the menu').toBe(false)
        expect(wrapper.findAll('svg.lucide-trash-2')).toHaveLength(1)
        // And the one that is on screen names the file it removes.
        expect(wrapper.get('[data-test="remove-sidecar"]').text()).toContain('examples/a.md')
    })

    it('opens the delete behind a labelled menu item', async () => {
        const wrapper = mountDesk()
        await wrapper.get('[data-test="desk-menu-trigger"]').trigger('click')
        const item = wrapper.get('[data-test="desk-delete"]')
        expect(item.text()).toContain('Delete skill')
    })

    it('closes the menu on the backdrop without deleting', async () => {
        const wrapper = mountDesk()
        await wrapper.get('[data-test="desk-menu-trigger"]').trigger('click')
        expect(wrapper.find('[data-test="desk-menu"]').exists()).toBe(true)
        await wrapper.get('[data-test="desk-menu-backdrop"]').trigger('click')
        expect(wrapper.find('[data-test="desk-menu"]').exists()).toBe(false)
        expect(wrapper.emitted('delete')).toBeUndefined()
    })
})

describe('SkillDesk → the file being written', () => {
    it('writes in md-editor-v3, so a skill body gets the formatting toolbar', () => {
        const wrapper = mountDesk({ skill: makeSkill({ body: '# Title' }) })
        const editor = wrapper.get('[data-testid="md-editor-stub"]')
        expect(editor.attributes('data-md-editor')).toBe('true')

        const toolbars: string[] = JSON.parse(editor.attributes('data-md-toolbars') ?? '[]')
        expect(toolbars).toContain('bold')
        expect(toolbars).toContain('task')
        expect(toolbars).toContain('table')
        // `mermaid`/`formula` are left out, as in the memories editor: a skill
        // body is prose, not a document set.
        expect(toolbars).not.toContain('mermaid')
        expect(toolbars).not.toContain('formula')
    })

    it('offers no toolbar at all when read-only, so nothing looks editable', () => {
        const wrapper = mountDesk({ skill: makeSkill(), readOnly: true })
        const editor = wrapper.get('[data-testid="md-editor-stub"]')
        expect(editor.attributes('data-md-readonly')).toBe('true')
        expect(JSON.parse(editor.attributes('data-md-toolbars') ?? '[]')).toEqual([])
    })

    it('counts the body in lines for the size readout', () => {
        const wrapper = mountDesk({ skill: makeSkill({ body: 'one\ntwo\nthree' }) })
        expect(wrapper.get('[data-test="desk-size"]').text()).toContain('3 lines')
    })

    it('reports the size in bytes against the per-file cap', () => {
        const wrapper = mountDesk({ skill: makeSkill({ body: 'abcd' }) })
        const readout = wrapper.get('[data-test="desk-size"]').text()
        expect(readout).toContain('4 B')
        expect(readout).toContain('50 KB')
    })

    it('opens on SKILL.md and can be pointed at a sidecar', async () => {
        const wrapper = mountDesk({ fileContents: { 'examples/invoice.md': '# Example body' } })
        expect(wrapper.get('[data-test="desk-source"]').attributes('aria-label')).toBe('SKILL.md source')
        await wrapper.findAll('[data-test="rail-file"]')[0]?.trigger('click')
        expect(wrapper.get('[data-test="desk-source"]').attributes('aria-label')).toBe('examples/invoice.md source')
        expect((wrapper.get('[data-testid="md-editor-stub"]').element as HTMLTextAreaElement).value).toBe('# Example body')
    })

    it('writes a sidecar to its own file, not into the body', async () => {
        const wrapper = mountDesk({ fileContents: { 'examples/invoice.md': '' } })
        await wrapper.get('[data-testid="md-editor-stub"]').setValue('# SKILL body')
        await wrapper.findAll('[data-test="rail-file"]')[0]?.trigger('click')
        await wrapper.get('[data-testid="md-editor-stub"]').setValue('# Sidecar body')
        wrapper.get('[data-test="desk-save"]').trigger('click')

        const payload = wrapper.emitted('save')?.[0]?.[0] as { body: string; files: Record<string, string> }
        expect(payload.body).toBe('# SKILL body')
        expect(payload.files).toEqual({ 'examples/invoice.md': '# Sidecar body' })
    })

    it('asks the page for sidecar contents on open, and not for a skill with none', () => {
        expect(mountDesk().emitted('loadFiles')?.[0]).toEqual(['invoice-drafting'])
        expect(mountDesk({ skill: makeSkill({ files: [{ path: 'SKILL.md', bytes: 10 }] }) })
            .emitted('loadFiles')).toBeUndefined()
    })

    it('gives a new sidecar a usable path and opens it', async () => {
        const wrapper = mountDesk()
        await wrapper.get('[data-test="add-file"]').trigger('click')
        const rows = wrapper.findAll('[data-test="rail-file"]')
        expect(rows).toHaveLength(2)
        expect(wrapper.get('[data-test="desk-source"]').attributes('aria-label')).toBe('notes-2.md source')
    })

    it('renaming a sidecar keeps its content and moves the save target', async () => {
        const wrapper = mountDesk({ fileContents: { 'examples/invoice.md': '# Example' } })
        await wrapper.findAll('[data-test="rail-file"]')[0]?.trigger('click')
        await wrapper.get('[data-testid="md-editor-stub"]').setValue('# Example')
        await wrapper.get('[data-test="sidecar-path"]').setValue('examples/renamed.md')
        wrapper.get('[data-test="desk-save"]').trigger('click')

        const payload = wrapper.emitted('save')?.[0]?.[0] as { files: Record<string, string> }
        expect(payload.files).toEqual({ 'examples/renamed.md': '# Example' })
    })

    it('removes the open sidecar and returns to SKILL.md', async () => {
        const wrapper = mountDesk()
        await wrapper.findAll('[data-test="rail-file"]')[0]?.trigger('click')
        await wrapper.get('[data-test="remove-sidecar"]').trigger('click')
        expect(wrapper.get('[data-test="desk-source"]').attributes('aria-label')).toBe('SKILL.md source')
        wrapper.get('[data-test="desk-save"]').trigger('click')
        const payload = wrapper.emitted('save')?.[0]?.[0] as { files: Record<string, string> }
        expect(payload.files).toEqual({})
    })

    it('names the open file and its encoding in the footer', async () => {
        const wrapper = mountDesk({ principalName: 'Maya Fischer' })
        expect(wrapper.get('[data-test="desk-footer"]').text()).toContain('SKILL.md')
        expect(wrapper.get('[data-test="desk-footer"]').text()).toContain('Markdown')
        expect(wrapper.get('[data-test="desk-footer"]').text()).toContain('Maya Fischer')

        await wrapper.findAll('[data-test="rail-file"]')[0]?.trigger('click')
        expect(wrapper.get('[data-test="desk-footer-file"]').text()).toBe('examples/invoice.md')
    })
})

describe('SkillDesk → write / split / preview', () => {
    it('opens split, and swaps the panes without losing the buffer', async () => {
        const wrapper = mountDesk()
        expect(wrapper.find('[data-test="desk-source"]').exists()).toBe(true)
        expect(wrapper.find('[data-test="desk-preview"]').exists()).toBe(true)

        await wrapper.get('[data-test="mode-preview"]').trigger('click')
        expect(wrapper.find('[data-test="desk-source"]').exists()).toBe(false)
        expect(wrapper.get('[data-test="desk-preview"]').text()).toContain('Read the PO')

        await wrapper.get('[data-test="mode-write"]').trigger('click')
        expect(wrapper.find('[data-test="desk-preview"]').exists()).toBe(false)
        expect((wrapper.get('[data-testid="md-editor-stub"]').element as HTMLTextAreaElement).value)
            .toContain('Read the PO')
    })
})

describe('SkillDesk → the frontmatter disclosure', () => {
    it('is closed by default and carries the fields the desk view does not show', () => {
        const wrapper = mountDesk()
        const details = wrapper.get('[data-test="frontmatter-toggle"]').element.closest('details')
        expect(details?.hasAttribute('open')).toBe(false)
        expect(wrapper.find('[data-test="field-metadata"]').exists()).toBe(true)
    })

    it('carries the hand-written preview typography class, which is the only thing styling it', async () => {
        // `src/style.css` scopes `.md-preview` by hand — `important` does not
        // rewrite hand-written rules — so the class has to reach the rendered node
        // or the preview is unstyled prose.
        const wrapper = mountDesk()
        expect(wrapper.get('[data-test="desk-preview"] [data-testid="md-preview-stub"]').classes())
            .toContain('md-preview')
    })

    it('sends the edited frontmatter with the save', async () => {
        const wrapper = mountDesk()
        await wrapper.get('[data-test="field-description"]').setValue('Rewritten.')
        await wrapper.get('[data-test="field-allowed-tools"]').setValue('read_email, send_email')
        await wrapper.get('[data-test="field-license"]').setValue('')
        await wrapper.get('[data-test="field-metadata"]').setValue('{"tier":"pro"}')
        wrapper.get('[data-test="desk-save"]').trigger('click')

        expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({
            description: 'Rewritten.',
            body: '# Steps\n\n1. Read the PO.\n',
            license: null,
            compatibility: 'spora>=0.28',
            allowed_tools: 'read_email, send_email',
            metadata: { tier: 'pro' },
            files: { 'examples/invoice.md': '' },
        })
    })

    it('never sends a name — the contract rejects a rename with 422', async () => {
        const wrapper = mountDesk()
        await wrapper.get('[data-testid="md-editor-stub"]').setValue('# Changed')
        wrapper.get('[data-test="desk-save"]').trigger('click')
        expect(wrapper.emitted('save')?.[0]?.[0]).not.toHaveProperty('name')
    })

    it('refuses to submit unparseable metadata with a field-level message', async () => {
        const wrapper = mountDesk()
        await wrapper.get('[data-test="field-metadata"]').setValue('{not json')
        await wrapper.get('[data-test="desk-save"]').trigger('click')
        expect(wrapper.emitted('save')).toBeUndefined()
        expect(wrapper.get('[data-test="field-metadata"]').attributes('aria-invalid')).toBe('true')
    })

    it('rejects a JSON array — the field is an object, not a list', async () => {
        const wrapper = mountDesk()
        await wrapper.get('[data-test="field-metadata"]').setValue('[1,2]')
        await wrapper.get('[data-test="desk-save"]').trigger('click')
        expect(wrapper.get('[data-test="field-metadata"]').attributes('aria-invalid')).toBe('true')
    })
})

describe('SkillDesk → validation feedback', () => {
    it('puts a description error under the description field, not in a banner', () => {
        const wrapper = mountDesk({
            validationErrors: [makeValidationEntry({ code: 'DESCRIPTION_TOO_LONG', message: 'over 1024 chars', path: 'description' })],
        })
        expect(wrapper.get('[data-test="field-description"]').attributes('aria-invalid')).toBe('true')
        expect(wrapper.findAll('[data-test="field-error"]')).toHaveLength(1)
        expect(wrapper.find('[data-test="validation-banner"]').exists()).toBe(false)
    })

    it('maps the validator’s hyphenated `allowed-tools` path onto the Allowed tools field', () => {
        const wrapper = mountDesk({
            validationErrors: [makeValidationEntry({ code: 'TOOL_UNKNOWN', message: 'unknown tool', path: 'allowed-tools' })],
        })
        expect(wrapper.get('[data-test="field-allowed-tools"]').attributes('aria-invalid')).toBe('true')
    })

    it('banners a warning with its code and path', () => {
        const wrapper = mountDesk({
            validationErrors: [makeValidationEntry({
                code: 'BODY_SOFT_BYTE_LIMIT',
                severity: 'warning',
                message: 'Body is above the soft byte limit.',
                path: 'body',
            })],
        })
        const banner = wrapper.get('[data-test="validation-banner"]')
        expect(banner.text()).toContain('BODY_SOFT_BYTE_LIMIT')
        expect(banner.text()).toContain('(body)')
    })

    it('banners the warnings the stored skill already carries', () => {
        const wrapper = mountDesk({
            skill: makeSkill({ warnings: [{ code: 'TOO_MANY_FILES', severity: 'warning', message: 'nearing the cap' }] }),
        })
        expect(wrapper.get('[data-test="validation-banner"]').text()).toContain('TOO_MANY_FILES')
    })

    it('banners an error no field claims, rather than dropping it', () => {
        const wrapper = mountDesk({
            validationErrors: [makeValidationEntry({ code: 'METADATA_INVALID', message: 'tier must be a string', path: 'metadata' })],
        })
        expect(wrapper.get('[data-test="validation-banner"]').text()).toContain('METADATA_INVALID')
    })

    it('renders no banner when there is nothing to report', () => {
        expect(mountDesk().find('[data-test="validation-banner"]').exists()).toBe(false)
    })
})
