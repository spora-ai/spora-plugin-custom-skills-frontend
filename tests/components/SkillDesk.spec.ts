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
 *
 * The `allowed-tools` group gets its own block below, covering the one property
 * that is not obvious: its options are the tool registry *unioned with* whatever the
 * stored value declares, so a name this instance cannot resolve is shown rather than
 * dropped. Dropping it would delete a declaration on the next unrelated save.
 */
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SkillDesk from '../../src/components/SkillDesk.vue'
import SourceEditor from '../../src/components/SourceEditor.vue'
import { makeSkill, makeTools, makeValidationEntry } from '../fixtures'
import { CONVENTIONAL_SKILL_FOLDERS } from '../../src/lib/skillFormat'

function mountDesk(props: Record<string, unknown> = {}) {
    return mount(SkillDesk, { props: { skill: makeSkill(), ...props } })
}

describe('SkillDesk → the rail cannot be empty', () => {
    it('always offers SKILL.md, first and selected', () => {
        const wrapper = mountDesk()
        const rail = wrapper.get('[data-test="file-rail"]')
        expect(rail.findAll('[data-test="rail-entry"]')).toHaveLength(1)
        expect(rail.findAll('[data-test="rail-entry"]')[0]?.text()).toContain('SKILL.md')
        expect(rail.findAll('[data-test^="rail-file-"]')).toHaveLength(1)
    })

    it('offers SKILL.md even for a skill with no sidecars at all', () => {
        const wrapper = mountDesk({ skill: makeSkill({ files: [{ path: 'SKILL.md', bytes: 10 }] }) })
        expect(wrapper.findAll('[data-test="rail-entry"]')).toHaveLength(1)
        expect(wrapper.findAll('[data-test^="rail-file-"]')).toHaveLength(0)
    })

    it('gives SKILL.md no remove control, and only the sidecar one', async () => {
        const wrapper = mountDesk()
        // SKILL.md is the active file, so no sidecar is removable either.
        expect(wrapper.find('[data-test="remove-sidecar"]').exists()).toBe(false)

        await wrapper.findAll('[data-test^="rail-file-"]')[0]?.trigger('click')
        const remove = wrapper.get('[data-test="remove-sidecar"]')
        expect(remove.text()).toContain('examples/invoice.md')
    })

    it('says why the rail cannot be emptied', () => {
        expect(mountDesk().get('[data-test="file-rail"]').text()).toContain('Every skill has a')
    })
})

describe('SkillDesk → folders', () => {
    const nested = () => mountDesk({
        skill: makeSkill({
            files: [
                { path: 'SKILL.md', bytes: 10 },
                { path: 'examples/invoice.md', bytes: 4 },
                { path: 'examples/cover.md', bytes: 4 },
                { path: 'data.json', bytes: 12 },
            ],
        }),
        fileContents: { 'examples/invoice.md': '# Invoice', 'examples/cover.md': '# Cover', 'data.json': '{}' },
    })

    it('groups sidecars under a folder row rather than a flat list', () => {
        const wrapper = nested()
        expect(wrapper.find('[data-test="rail-folder-examples"]').exists()).toBe(true)
        // The leaf shows its basename; the folder is what carries the prefix.
        expect(wrapper.get('[data-test="rail-file-examples/invoice.md"]').text()).toContain('invoice.md')
        expect(wrapper.find('[data-test="rail-file-data.json"]').exists()).toBe(true)
    })

    it('collapses and expands a folder', async () => {
        const wrapper = nested()
        const folder = wrapper.get('[data-test="rail-folder-examples"]')
        expect(folder.attributes('aria-expanded')).toBe('true')

        await folder.trigger('click')
        expect(wrapper.find('[data-test="rail-file-examples/invoice.md"]').exists()).toBe(false)
        // The folder itself stays, or there would be no way back.
        expect(wrapper.find('[data-test="rail-folder-examples"]').exists()).toBe(true)

        await wrapper.get('[data-test="rail-folder-examples"]').trigger('click')
        expect(wrapper.find('[data-test="rail-file-examples/invoice.md"]').exists()).toBe(true)
    })

    it('puts a new file inside the folder the open file is in', async () => {
        const wrapper = nested()
        await wrapper.get('[data-test="rail-file-examples/invoice.md"]').trigger('click')
        await wrapper.get('[data-test="add-file"]').trigger('click')
        // It belongs where the operator is working, not at the root.
        expect((wrapper.get('[data-test="file-dialog-folder"]').element as HTMLInputElement).value)
            .toBe('examples')
    })

    it('adds at the root when the open file is at the root', async () => {
        const wrapper = nested()
        await wrapper.get('[data-test="add-file"]').trigger('click')
        expect((wrapper.get('[data-test="file-dialog-folder"]').element as HTMLInputElement).value)
            .toBe('')
    })

    it('moves a file into a folder through the dialog', async () => {
        const wrapper = nested()
        await wrapper.get('[data-test="rail-file-data.json"]').trigger('click')
        await wrapper.get('[data-test="rename-file"]').trigger('click')
        await wrapper.get('[data-test="file-dialog-folder"]').setValue('config')
        await wrapper.get('[data-test="file-dialog-submit"]').trigger('click')
        // The folder appears because a file inside it now exists.
        expect(wrapper.find('[data-test="rail-folder-config"]').exists()).toBe(true)
        expect(wrapper.find('[data-test="rail-file-config/data.json"]').exists()).toBe(true)
    })
})

describe('SkillDesk → the file dialog', () => {
    it('offers the spec’s own folder names, because that is what a reader expects', async () => {
        const wrapper = mountDesk()
        await wrapper.get('[data-test="add-file"]').trigger('click')
        const dialog = wrapper.get('[data-test="file-dialog"]')
        for (const folder of CONVENTIONAL_SKILL_FOLDERS) {
            expect(dialog.text()).toContain(folder)
        }
    })

    it('suggests a name that is free, and does not insist on it', async () => {
        const wrapper = mountDesk()
        await wrapper.get('[data-test="add-file"]').trigger('click')
        // A suggestion, not a decision: the point of the dialog is that the name is
        // the operator's to choose, which the inline path edit never allowed.
        expect((wrapper.get('[data-test="file-dialog-name"]').element as HTMLInputElement).value)
            .toBe('notes-2.md')
        await wrapper.get('[data-test="file-dialog-name"]').setValue('REFERENCE.md')
        await wrapper.get('[data-test="file-dialog-folder"]').setValue('references')
        await wrapper.get('[data-test="file-dialog-submit"]').trigger('click')
        expect(wrapper.find('[data-test="rail-file-references/REFERENCE.md"]').exists()).toBe(true)
    })

    it('will not create a file on top of another one', async () => {
        const wrapper = mountDesk()
        await wrapper.get('[data-test="add-file"]').trigger('click')
        await wrapper.get('[data-test="file-dialog-name"]').setValue('invoice.md')
        await wrapper.get('[data-test="file-dialog-folder"]').setValue('examples')
        await wrapper.get('[data-test="file-dialog-submit"]').trigger('click')
        expect(wrapper.find('[data-test="file-dialog-error"]').text()).toContain('already exists')
        // Still open, and nothing was added.
        expect(wrapper.find('[data-test="file-dialog"]').exists()).toBe(true)
        expect(wrapper.findAll('[data-test^="rail-file-"]')).toHaveLength(1)
    })

    it('will not add a second SKILL.md, which the server cannot store', async () => {
        const wrapper = mountDesk()
        await wrapper.get('[data-test="add-file"]').trigger('click')
        await wrapper.get('[data-test="file-dialog-name"]').setValue('SKILL.md')
        await wrapper.get('[data-test="file-dialog-submit"]').trigger('click')
        // `SKILL.md` is synthesised from the skill's own columns, so it is not a
        // `files` row and no duplicate scan would ever catch it.
        expect(wrapper.find('[data-test="file-dialog-error"]').text()).toContain('always exists')
        expect(wrapper.findAll('[data-test^="rail-file-"]')).toHaveLength(1)
    })

    it('refuses a folder that climbs out of the skill', async () => {
        const wrapper = mountDesk()
        await wrapper.get('[data-test="add-file"]').trigger('click')
        await wrapper.get('[data-test="file-dialog-folder"]').setValue('../secrets')
        await wrapper.get('[data-test="file-dialog-submit"]').trigger('click')
        expect(wrapper.find('[data-test="file-dialog-error"]').exists()).toBe(true)
        expect(wrapper.findAll('[data-test^="rail-file-"]')).toHaveLength(1)
    })

    it('cancels without adding a file', async () => {
        const wrapper = mountDesk()
        await wrapper.get('[data-test="add-file"]').trigger('click')
        await wrapper.get('[data-test="file-dialog-cancel"]').trigger('click')
        expect(wrapper.find('[data-test="file-dialog"]').exists()).toBe(false)
        expect(wrapper.findAll('[data-test^="rail-file-"]')).toHaveLength(1)
    })

    it('dismisses on Escape and on a click away, not only on the button', async () => {
        const wrapper = mountDesk()
        await wrapper.get('[data-test="add-file"]').trigger('click')
        await wrapper.get('[data-test="file-dialog"]').trigger('keydown.esc')
        expect(wrapper.find('[data-test="file-dialog"]').exists()).toBe(false)

        await wrapper.get('[data-test="add-file"]').trigger('click')
        await wrapper.get('[data-test="file-dialog-backdrop"]').trigger('click')
        expect(wrapper.find('[data-test="file-dialog"]').exists()).toBe(false)
        expect(wrapper.findAll('[data-test^="rail-file-"]')).toHaveLength(1)
    })

    it('opens no dialog for a shipped skill, which has nothing to write', async () => {
        const wrapper = mountDesk({ readOnly: true })
        expect(wrapper.find('[data-test="add-file"]').exists()).toBe(false)
    })

    it('opens the new file in the editor its extension calls for', async () => {
        const wrapper = mountDesk()
        await wrapper.get('[data-test="add-file"]').trigger('click')
        await wrapper.get('[data-test="file-dialog-name"]').setValue('extract.py')
        await wrapper.get('[data-test="file-dialog-folder"]').setValue('scripts')
        await wrapper.get('[data-test="file-dialog-submit"]').trigger('click')
        // A python script is not prose, so the markdown toolbar would be a lie.
        expect(wrapper.find('[data-testid="md-editor-stub"]').exists()).toBe(false)
        expect(wrapper.find('[data-test="source-editor"]').exists()).toBe(true)
    })
})

describe('SkillDesk → files that are not markdown', () => {
    const withJson = () => mountDesk({
        skill: makeSkill({
            files: [{ path: 'SKILL.md', bytes: 10 }, { path: 'data.json', bytes: 12 }],
        }),
        fileContents: { 'data.json': '{"a":1}' },
    })

    it('does not offer a markdown toolbar for a JSON sidecar', async () => {
        const wrapper = withJson()
        await wrapper.get('[data-test="rail-file-data.json"]').trigger('click')
        expect(wrapper.find('[data-testid="md-editor-stub"]').exists()).toBe(false)
        expect(wrapper.find('[data-test="source-editor"]').exists()).toBe(true)
    })

    it('gives a non-markdown sidecar a real code editor, with its language', async () => {
        const wrapper = withJson()
        await wrapper.get('[data-test="rail-file-data.json"]').trigger('click')
        const editor = wrapper.get('[data-test="source-editor"]')
        // CodeMirror, not a textarea: line numbers, search and a mode.
        expect(editor.attributes('data-language')).toBe('json')
        expect(editor.find('.cm-editor').exists()).toBe(true)
        expect(editor.find('.cm-gutters').exists(), 'line numbers come with basicSetup').toBe(true)
    })

    it('does not render a JSON sidecar as prose in the preview', async () => {
        const wrapper = withJson()
        await wrapper.get('[data-test="rail-file-data.json"]').trigger('click')
        expect(wrapper.find('[data-testid="md-preview-stub"]').exists()).toBe(false)
        // The source, verbatim — not a markdown rendering of it.
        expect(wrapper.get('[data-test="source-editor"]').text()).toContain('{"a":1}')
    })

    it('names the format in the footer rather than claiming Markdown', async () => {
        const wrapper = withJson()
        await wrapper.get('[data-test="rail-file-data.json"]').trigger('click')
        expect(wrapper.get('[data-test="desk-footer"]').text()).toContain('JSON')
        expect(wrapper.get('[data-test="desk-footer"]').text()).not.toContain('Markdown')
    })

    it('keeps the markdown surface for a markdown sidecar', async () => {
        const wrapper = mountDesk({
            skill: makeSkill({ files: [{ path: 'SKILL.md', bytes: 10 }, { path: 'ref.md', bytes: 4 }] }),
            fileContents: { 'ref.md': '# Ref' },
        })
        await wrapper.get('[data-test="rail-file-ref.md"]').trigger('click')
        expect(wrapper.find('[data-testid="md-editor-stub"]').exists()).toBe(true)
        expect(wrapper.find('[data-test="source-editor"]').exists()).toBe(false)
    })

    it('writes a non-markdown sidecar back to its own file', async () => {
        const wrapper = withJson()
        await wrapper.get('[data-test="rail-file-data.json"]').trigger('click')
        // CodeMirror drives the buffer through `update:modelValue`; emitting it
        // is the same edge its own listener produces.
        wrapper.findComponent(SourceEditor).vm.$emit('update:modelValue', '{"a":2}')
        await wrapper.vm.$nextTick()
        await wrapper.get('[data-test="desk-save"]').trigger('click')
        expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({ files: { 'data.json': '{"a":2}' } })
    })
})

describe('SkillDesk → the header', () => {
    it('shows the name and locks it', () => {
        const wrapper = mountDesk()
        expect(wrapper.get('[data-test="desk-title"]').text()).toBe('invoice-drafting')
        // The contract rejects a rename with 422, so there is no name input to
        // offer here at all. The lock has to say why *and* what to do instead —
        // "cannot be changed" on its own leaves the operator hunting.
        const lock = wrapper.get('[data-test="desk-name-lock"]')
        expect(wrapper.find('[data-test="field-name"]').exists()).toBe(false)
        expect(lock.attributes('title')).toContain('cannot be changed')
        expect(lock.attributes('title')).toContain('Duplicate')
        // Not hover-only: the same text is the accessible name.
        expect(lock.attributes('aria-label')).toBe(lock.attributes('title'))
    })

    it('opens "saved", and says "unsaved changes" only once the buffer diverges', async () => {
        const wrapper = mountDesk()
        expect(wrapper.get('[data-test="desk-state"]').text()).toBe('saved')
        expect(wrapper.get('[data-test="desk-save"]').attributes('disabled')).toBeDefined()

        await wrapper.get('[data-testid="md-editor-stub"]').setValue('# Rewritten')
        expect(wrapper.get('[data-test="desk-state"]').text()).toBe('unsaved changes')
        expect(wrapper.get('[data-test="desk-save"]').attributes('disabled')).toBeUndefined()
    })

    it('stays "saved" once the sidecar contents land', async () => {
        // The page loads sidecar bodies in a second request, so they arrive after
        // the row is first rendered. The baseline is what the *server* holds, so
        // content arriving is not an edit — comparing against the buffer at load
        // time made every skill with a sidecar look permanently unsaved, and saving
        // it did not help because the next load repeated it.
        const wrapper = mountDesk({
            fileContents: { 'examples/invoice.md': '# Invoice' },
        })
        await flushPromises()
        expect(wrapper.get('[data-test="desk-state"]').text()).toBe('saved')
        expect(wrapper.get('[data-test="desk-save"]').attributes('disabled')).toBeDefined()
    })

    it('calls an edited sidecar unsaved, so its content is still a real edit', async () => {
        const wrapper = mountDesk({
            fileContents: { 'examples/invoice.md': '# Invoice' },
        })
        await flushPromises()
        await wrapper.findAll('[data-test^="rail-file-"]')[0]?.trigger('click')
        await wrapper.get('[data-testid="md-editor-stub"]').setValue('# Changed')
        expect(wrapper.get('[data-test="desk-state"]').text()).toBe('unsaved changes')
    })

    it('calls a newly added sidecar unsaved, because the server has no such file', async () => {
        const wrapper = mountDesk({
            fileContents: { 'examples/invoice.md': '# Invoice' },
        })
        await flushPromises()
        expect(wrapper.get('[data-test="desk-state"]').text()).toBe('saved')
        await wrapper.get('[data-test="add-file"]').trigger('click')
        await wrapper.get('[data-test="file-dialog-submit"]').trigger('click')
        expect(wrapper.get('[data-test="desk-state"]').text()).toBe('unsaved changes')
    })

    it('says what restore will do, and that it is a toggle rather than a history', () => {
        const wrapper = mountDesk()
        const restore = wrapper.get('[data-test="desk-restore"]')
        const text = restore.attributes('title') ?? ''

        // One earlier version exists, so the label names it rather than implying a
        // stack — and restoring swaps the two, so it is not destructive.
        expect(restore.text()).toMatch(/Restore the version from|Restore previous version/)
        expect(text).toContain('only earlier version kept')
        expect(text).toContain('restore again to come back')
        // Sidecars ride along, which is the part a "previous version" label hides.
        expect(text).toContain('Sidecar files')
        // Not hover-only.
        expect(restore.attributes('aria-label')).toBe(text)
    })

    it('falls back to the plain label when the snapshot predates the timestamp', () => {
        const wrapper = mountDesk({ skill: makeSkill({ previous_at: null }) })
        expect(wrapper.get('[data-test="desk-restore"]').text()).toBe('Restore previous version')
    })

    it('offers restore only when the server holds a previous snapshot', () => {
        expect(mountDesk().find('[data-test="desk-restore"]').exists()).toBe(true)
        expect(mountDesk({ skill: makeSkill({ has_previous: false }) })
            .find('[data-test="desk-restore"]').exists()).toBe(false)
    })

    it('keeps the open file open across a save', async () => {
        // A save changes `updated_at`, which re-enters the reload. Resetting the open
        // file there meant the desk jumped to SKILL.md under the cursor every time.
        const skill = makeSkill()
        const wrapper = mountDesk({ skill, fileContents: { 'examples/invoice.md': '# Invoice' } })
        await flushPromises()
        await wrapper.findAll('[data-test^="rail-file-"]')[0]?.trigger('click')
        await wrapper.get('[data-testid="md-editor-stub"]').setValue('# Rewritten')
        expect(wrapper.get('[data-test="desk-footer-file"]').text()).toBe('examples/invoice.md')

        await wrapper.setProps({
            skill: makeSkill({ body: skill.body, updated_at: '2026-10-02 10:00:00' }),
            fileContents: { 'examples/invoice.md': '# Rewritten' },
        })
        await flushPromises()

        expect(wrapper.get('[data-test="desk-footer-file"]').text()).toBe('examples/invoice.md')
        expect(wrapper.get('[data-test="desk-state"]').text()).toBe('saved')
    })

    it('moves off a file that the save itself deleted', async () => {
        const skill = makeSkill()
        const wrapper = mountDesk({ skill, fileContents: { 'examples/invoice.md': '# Invoice' } })
        await flushPromises()
        await wrapper.findAll('[data-test^="rail-file-"]')[0]?.trigger('click')

        await wrapper.setProps({
            skill: makeSkill({
                files: [{ path: 'SKILL.md', bytes: 10 }],
                updated_at: '2026-10-02 10:00:00',
            }),
        })
        await flushPromises()

        expect(wrapper.get('[data-test="desk-footer-file"]').text()).toBe('SKILL.md')
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
        await wrapper.findAll('[data-test^="rail-file-"]')[0]?.trigger('click')

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
    it('writes in md-editor-v3, so a skill body gets the formatting toolbar', () => {        const wrapper = mountDesk({ skill: makeSkill({ body: '# Title' }) })
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
        await wrapper.findAll('[data-test^="rail-file-"]')[0]?.trigger('click')
        expect(wrapper.get('[data-test="desk-source"]').attributes('aria-label')).toBe('examples/invoice.md source')
        expect((wrapper.get('[data-testid="md-editor-stub"]').element as HTMLTextAreaElement).value).toBe('# Example body')
    })

    it('writes a sidecar to its own file, not into the body', async () => {
        const wrapper = mountDesk({ fileContents: { 'examples/invoice.md': '' } })
        await wrapper.get('[data-testid="md-editor-stub"]').setValue('# SKILL body')
        await wrapper.findAll('[data-test^="rail-file-"]')[0]?.trigger('click')
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
        await wrapper.get('[data-test="file-dialog-submit"]').trigger('click')
        const rows = wrapper.findAll('[data-test^="rail-file-"]')
        expect(rows).toHaveLength(2)
        expect(wrapper.get('[data-test="desk-source"]').attributes('aria-label')).toBe('notes-2.md source')
    })

    it('renaming a sidecar keeps its content and moves the save target', async () => {
        const wrapper = mountDesk({ fileContents: { 'examples/invoice.md': '# Example' } })
        await wrapper.findAll('[data-test^="rail-file-"]')[0]?.trigger('click')
        await wrapper.get('[data-testid="md-editor-stub"]').setValue('# Example')
        await wrapper.get('[data-test="rename-file"]').trigger('click')
        await wrapper.get('[data-test="file-dialog-name"]').setValue('renamed.md')
        await wrapper.get('[data-test="file-dialog-submit"]').trigger('click')
        wrapper.get('[data-test="desk-save"]').trigger('click')

        const payload = wrapper.emitted('save')?.[0]?.[0] as { files: Record<string, string> }
        expect(payload.files).toEqual({ 'examples/renamed.md': '# Example' })
    })

    it('removes the open sidecar and returns to SKILL.md', async () => {
        const wrapper = mountDesk()
        await wrapper.findAll('[data-test^="rail-file-"]')[0]?.trigger('click')
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

        await wrapper.findAll('[data-test^="rail-file-"]')[0]?.trigger('click')
        expect(wrapper.get('[data-test="desk-footer-file"]').text()).toBe('examples/invoice.md')
    })
})

describe('SkillDesk → write / split / preview', () => {
    it('lets the editor own its preview, instead of a second copy of the same control', async () => {
        const wrapper = mountDesk()

        // `MdEditor` ships a preview toggle in its own toolbar. The panel had a
        // plainer Write / Split / Preview group above it, so there were two ways to
        // say the same thing and the outer one could disagree with the inner one
        // about what was on screen.
        expect(wrapper.find('[data-test="mode-write"]').exists()).toBe(false)
        expect(wrapper.find('[data-test="mode-split"]').exists()).toBe(false)
        expect(wrapper.find('[data-test="mode-preview"]').exists()).toBe(false)
        expect(wrapper.find('[data-test="desk-preview"]').exists()).toBe(false)
        expect(wrapper.find('[data-test="desk-editor"]').exists()).toBe(true)
    })

    it('nests the pane, not just the class names', async () => {
        // A `</div>` went missing when the open-file bar was added, so the bar
        // swallowed the frontmatter, the editor and the footer as its children. It
        // renders as a plain `flex items-center` row, so the result looked like a
        // layout nobody designed rather than an error. Asserting the class lists
        // did not catch it; only the shape does.
        const wrapper = mountDesk({
            fileContents: { 'examples/invoice.md': '# Invoice' },
        })
        await flushPromises()

        const pane = (test: string) => wrapper.get(`[data-test="${test}"]`).element
        const editorColumn = pane('open-file').parentElement as HTMLElement

        // The bar is a leaf row: the icon, the name, and the file's own actions.
        // Nothing that is a *region* may be a child of it — that is the regression.
        const barChildren = Array.from(pane('open-file').children)
            .map((c) => c.getAttribute('data-test') ?? c.tagName.toLowerCase())
        for (const region of ['frontmatter', 'desk-source', 'desk-footer']) {
            expect(barChildren, `${region} became a child of the open-file bar`).not.toContain(region)
        }
        expect(barChildren).toContain('open-file-name')

        // …and it is a sibling of the three regions below it, not their parent.
        for (const region of ['frontmatter', 'desk-source', 'desk-footer']) {
            expect(editorColumn.contains(pane(region)), `${region} must be a sibling of the open-file bar`).toBe(true)
            expect(pane('open-file').contains(pane(region)), `${region} must not be inside the open-file bar`).toBe(false)
        }

        // The rail is outside the editor column, in the split beside it.
        expect(editorColumn.contains(pane('file-rail'))).toBe(false)
    })

    it('every flex container in the desk states its base direction', () => {
        // Three defects in this file were the same mistake, and the first two
        // checks were too narrow to catch the third:
        //
        //   1. a leftover `md:flex-row` on the desk root beat `flex-col`, so the
        //      whole desk became a row and the page grew to five viewports;
        //   2. the open-file bar was never closed, so it swallowed the editor;
        //   3. the split carried `md:flex-row` with *no* base direction, so it was
        //      a row at every width and the rail's `md:max-h-none`, `md:border-b-0`
        //      and `md:border-r` were all dead.
        //
        // A direction variant with no matching base resolves to the CSS initial
        // `row`, and reads as intentional in the source. So: a flex container that
        // switches direction across a breakpoint must say what it is at the base.
        const wrapper = mountDesk()
        const flexContainers = wrapper.findAll('[class*="flex"]')

        expect(flexContainers.length).toBeGreaterThan(0)

        for (const el of flexContainers) {
            const classes = (el.attributes('class') ?? '').split(/\s+/).filter(Boolean)
            const breakpointVariants = classes.filter((c) => /^(sm|md|lg|xl):flex-(row|col)$/.test(c))
            if (breakpointVariants.length === 0) continue

            const hasBase = classes.includes('flex-col') || classes.includes('flex-row')
            expect(
                hasBase,
                `${el.attributes('data-test') ?? el.element.tagName} switches direction at a `
                + `breakpoint (${breakpointVariants.join(', ')}) but has no base flex-row/flex-col, `
                + 'so it is a row at every width and its `md:` sizing is dead',
            ).toBe(true)
        }
    })

    it('the desk is a column, with no variant that turns it back into a row', () => {
        // Kept as its own check: a *conflicting* pair is worse than a missing base,
        // because the later rule silently wins and the result looks designed.
        const root = mountDesk().get('[data-test="skill-desk"]')
        const classes = (root.attributes('class') ?? '').split(/\s+/)
        expect(classes).toContain('flex-col')
        for (const c of classes) {
            expect(c, `"${c}" conflicts with flex-col on the desk root`).not.toBe('flex-row')
            expect(c, `"${c}" conflicts with flex-col on the desk root`).not.toBe('md:flex-row')
            expect(c, `"${c}" conflicts with flex-col on the desk root`).not.toBe('md:flex-col')
        }
    })

    it('keeps the preview toggles in the editor toolbar, or the split is a trap', () => {
        // `:preview="true"` gives the split view; the button that takes you out of
        // it comes from the `toolbars` array, not from that prop. Omitting these two
        // left the editor permanently split with no way to change it — which is what
        // removing the panel's own toggle would have done on its own.
        const toolbar = JSON.parse(
            mountDesk().get('[data-testid="md-editor-stub"]').attributes('data-md-toolbars') ?? '[]',
        ) as string[]

        expect(toolbar).toContain('preview')
        expect(toolbar).toContain('previewOnly')
        // Still no diagram or math modes: a skill body is prose, not a document set.
        expect(toolbar).not.toContain('mermaid')
        expect(toolbar).not.toContain('katex')
    })

    it('starts the editor split, since that is what :preview asks for', () => {
        expect(mountDesk().get('[data-testid="md-editor-stub"]').attributes('data-md-preview-on'))
            .toBe('true')
    })
})

describe('SkillDesk → the frontmatter', () => {
    it('is open on arrival, and carries the fields an agent matches on', () => {
        // Collapsible is worth having — the body is what most visits are for — but it
        // was closed by default, which put the description, the only field whose
        // absence is silent, two clicks deep.
        const wrapper = mountDesk()
        const disclosure = wrapper.get('[data-test="frontmatter"]')
        expect(disclosure.element.tagName).toBe('DETAILS')
        expect(disclosure.attributes('open')).toBeDefined()
        expect(wrapper.find('[data-test="field-description"]').exists()).toBe(true)
        expect(wrapper.find('[data-test="field-metadata"]').exists()).toBe(true)
    })

    it('can still be folded away, and says so on the toggle', async () => {
        const wrapper = mountDesk()
        const toggle = wrapper.get('[data-test="frontmatter-toggle"]')
        expect(toggle.text()).toContain('SKILL.md frontmatter')
        expect(toggle.text()).toContain('an agent matches')

        // The chevron, because a toggle that looks like a static heading is not one.
        // `lucide-vue-next` is real in these tests, so a missing import renders
        // nothing here — which is exactly what happened when `ChevronDown` was used
        // in the template without being imported, and nothing caught it.
        expect(toggle.find('svg').exists()).toBe(true)

        const disclosure = wrapper.get('[data-test="frontmatter"]')
        await toggle.trigger('click')
        expect(disclosure.element.hasAttribute('open')).toBe(false)

        await toggle.trigger('click')
        expect(disclosure.element.hasAttribute('open')).toBe(true)
    })

    it('keeps the buffer when the frontmatter is folded, because it is not the editor', async () => {        const wrapper = mountDesk()
        await wrapper.get('[data-testid="md-editor-stub"]').setValue('# Rewritten')
        await wrapper.get('[data-test="frontmatter-toggle"]').trigger('click')
        expect(wrapper.get('[data-test="frontmatter"]').element.hasAttribute('open')).toBe(false)
        expect((wrapper.get('[data-testid="md-editor-stub"]').element as HTMLTextAreaElement).value)
            .toContain('# Rewritten')
    })

    it('gives the description room for the 1024 characters the contract allows', () => {
        const wrapper = mountDesk()
        const field = wrapper.get('[data-test="field-description"]')
        // A single-line input scrolled this off the right edge with no wrap.
        expect(field.element.tagName).toBe('TEXTAREA')
        expect(field.attributes('maxlength')).toBe('1024')
        expect(field.attributes('rows')).toBe('3')
    })

    it('is hidden while a sidecar is open, and says nothing about it', async () => {
        // A sidecar has no frontmatter, and it can be renamed from the rail — so a
        // message naming it would be about a file that may not exist under that name
        // by the time it is read. It is simply not there.
        const wrapper = mountDesk({
            fileContents: { 'examples/invoice.md': '# Invoice' },
        })
        await flushPromises()
        expect(wrapper.find('[data-test="frontmatter"]').exists()).toBe(true)

        await wrapper.get('[data-test="rail-file-examples/invoice.md"]').trigger('click')

        expect(wrapper.find('[data-test="frontmatter"]').exists()).toBe(false)
        expect(wrapper.find('[data-test="frontmatter-elsewhere"]').exists()).toBe(false)
        expect(wrapper.text()).not.toContain('no frontmatter')
    })

    it('styles the preview it no longer renders itself', () => {
        // The desk let `<MdEditor>` own the preview pane, so the class this repo
        // controls is gone from the desk — but `src/style.css` now scopes the prose
        // rules to `.md-editor-preview` as well, which is what that pane renders.
        // Without it the desk's prose would be `md-editor-v3`'s 16px default while
        // the viewer read the same file at 14px.
        const css = readFileSync('src/style.css', 'utf8')
        expect(css).toContain('#spora-plugin-custom-skills .md-editor-preview {')
        // …and the viewer still has its own class.
        expect(css).toContain('#spora-plugin-custom-skills .md-preview,')
        // Both fixes from the earlier pass, applied to whichever class is in play.
        expect(css).toMatch(/\.md-editor-preview \*\s*\{\s*word-break: normal;\s*overflow-wrap: anywhere;/)
        expect(css).not.toMatch(/max-width: 65ch/)
    })

    it('sends the edited frontmatter with the save', async () => {
        const wrapper = mountDesk()
        await wrapper.get('[data-test="field-description"]').setValue('Rewritten.')
        await wrapper.get('[data-test="field-license"]').setValue('')
        await wrapper.get('[data-test="field-metadata"]').setValue('{"tier":"pro"}')
        wrapper.get('[data-test="desk-save"]').trigger('click')

        expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({
            description: 'Rewritten.',
            body: '# Steps\n\n1. Read the PO.\n',
            license: null,
            compatibility: 'spora>=0.28',
            // Untouched, so the save re-sends it exactly as the server holds it.
            allowed_tools: 'agent read_url',
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

/**
 * The declared-tools group.
 *
 * `allowed-tools` is a space-separated list of bare tool names — a grammar, not a
 * free-text field — so this is a checkbox group over the instance's registry. Two
 * properties are load-bearing and each is worth a test on its own:
 *
 * 1. **The options are the registry unioned with the stored names.** A declared name
 *    no installed tool answers to is still shown, disabled, and still submitted. If
 *    it were dropped, saving an unrelated field would silently delete a declaration
 *    the author can see no trace of — which is why core calls it a warning
 *    (`ALLOWED_TOOLS_UNKNOWN_TOOL`) rather than an error.
 * 2. **The stored string is the buffer.** A malformed value the author has not fixed
 *    is not tidied on the way through; core reports it, this shows it.
 */
describe('SkillDesk → the declared tools', () => {
    const withTools = (props: Record<string, unknown> = {}) => mountDesk({ tools: makeTools(), ...props })

    const boxes = (wrapper: ReturnType<typeof mountDesk>) =>
        wrapper.findAll('[data-test="field-allowed-tools"] input[type="checkbox"]')

    /** A skill declaring only names this instance cannot resolve. */
    const unresolvable = () => makeSkill({ allowed_tools: 'read_url' })

    it('offers every registered tool, with its display name and description', () => {
        const wrapper = withTools({ skill: makeSkill({ allowed_tools: null }) })
        const rows = wrapper.findAll('[data-test^="tool-option-"]')

        // The registry in its own order, and nothing else, for a skill that
        // declares nothing.
        expect(rows.map((r) => r.attributes('data-test'))).toEqual([
            'tool-option-agent',
            'tool-option-calendar',
        ])
        // The display name, not the wire name, is the label a human reads.
        expect(rows[0]?.text()).toContain('Agent')
        expect(rows[0]?.text()).toContain('Run another agent.')
        // A tool with no description degrades to the name alone rather than
        // rendering an empty line where the description would be.
        expect(rows[1]?.text()).not.toContain('Run another agent.')
    })

    it('checks the boxes for the names the skill already declares', () => {
        const wrapper = withTools({ skill: makeSkill({ allowed_tools: 'agent read_url' }) })
        const checked = boxes(wrapper)
            .filter((box) => (box.element as HTMLInputElement).checked)
            .map((box) => (box.element as HTMLInputElement).value)

        // Both declared names are ticked, the registered one and the one that is
        // not — a declaration is a declaration whichever way it resolves.
        expect(checked).toEqual(['agent', 'read_url'])
    })

    it('keeps a declared name this instance does not have, as a disabled row', () => {
        // The failure this prevents: a name that vanishes from the group is a
        // declaration the next save of an unrelated field deletes silently.
        const wrapper = withTools({ skill: unresolvable() })

        // `get` throws when there is nothing to get, so reaching here is the claim.
        const row = wrapper.get('[data-test="tool-option-read_url"]')
        expect(row.text()).toContain('read_url')
        expect(row.text()).toContain('Not available on this instance')
        const input = row.get('input')
        expect(input.attributes('disabled')).toBeDefined()
        // Checked, so it is part of the declaration rather than a visible orphan.
        expect((input.element as HTMLInputElement).checked).toBe(true)
    })

    it('labels the field as a hint, not as a grant or a requirement', () => {
        const wrapper = withTools()
        const field = wrapper.get('[data-test="field-allowed-tools"]')
        expect(field.text()).toContain('Tools this skill uses')
        // "Required tools" would promise enforcement Spora does not do.
        expect(field.text()).not.toMatch(/required|pre-approved/i)
        expect(field.text()).toContain('grants no pre-approval')
    })

    it('says so plainly when this instance has no tools at all', () => {
        // `[]` — a read that came back and found nothing, which is different from a
        // read that did not come back.
        const wrapper = mountDesk({ tools: [], skill: makeSkill({ allowed_tools: null }) })
        expect(wrapper.get('[data-test="allowed-tools-empty"]').text()).toContain('No tools are registered')
    })

    it('still shows the declaration when the registry could not be read', () => {
        // `tools: null` is "not read", which is a different state from an instance
        // with no tools. A failed read must not turn a declaration the author is
        // allowed to change into a read-only one, and must not claim a tool is
        // absent when the registry that would know has not answered.
        const wrapper = mountDesk({ tools: null, skill: makeSkill({ allowed_tools: 'agent read_url' }) })
        expect(wrapper.findAll('[data-test^="tool-option-"]')).toHaveLength(2)
        expect(wrapper.get('[data-test="tool-option-agent"] input').attributes('disabled')).toBeUndefined()
        expect(wrapper.get('[data-test="tool-option-read_url"] input').attributes('disabled')).toBeUndefined()
        expect(wrapper.find('[data-test="tool-unavailable-note"]').exists()).toBe(false)
    })

    it('does not claim the instance has no tools when the registry read failed', () => {
        // The empty state and the failed read both produce zero rows, so the sentence
        // has to be chosen on `tools` rather than on the row count — otherwise a
        // failed read asserts something about the deployment it cannot support. This
        // is also the page's initial state, before `onMounted` resolves the registry.
        const wrapper = mountDesk({ tools: null, skill: makeSkill({ allowed_tools: null }) })
        expect(wrapper.find('[data-test="allowed-tools-empty"]').exists()).toBe(false)
        expect(wrapper.get('[data-test="allowed-tools-unavailable"]').text()).toContain('could not be read')
    })

    it('checking a tool appends its name to the submitted string', async () => {
        const wrapper = withTools({ skill: unresolvable() })
        await wrapper.get('[data-test="tool-option-agent"] input').setValue(true)
        await wrapper.get('[data-test="desk-save"]').trigger('click')

        // Space-separated bare names, appended to what was already stored: the
        // author's own ordering is not reshuffled by a checkbox.
        expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
            allowed_tools: 'read_url agent',
        })
    })

    it('unchecking a tool removes exactly that name and keeps the rest', async () => {
        const wrapper = withTools({ skill: makeSkill({ allowed_tools: 'agent calendar' }) })
        await wrapper.get('[data-test="tool-option-agent"] input').setValue(false)
        await wrapper.get('[data-test="desk-save"]').trigger('click')

        // So the string is rebuilt from the selection rather than trimmed, and
        // `calendar` is untouched by the removal of `agent`.
        expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({ allowed_tools: 'calendar' })
    })

    it('sends null when every box is cleared, because that is a revocation', async () => {
        // `agent` is the only declared name here, and it is registered, so its box
        // is the one the author can clear.
        const wrapper = withTools({ skill: makeSkill({ allowed_tools: 'agent' }) })
        await wrapper.get('[data-test="tool-option-agent"] input').setValue(false)
        expect(boxes(wrapper).some((b) => (b.element as HTMLInputElement).checked)).toBe(false)

        await wrapper.get('[data-test="desk-save"]').trigger('click')
        // Not `''`: the plugin treats an absent key as "leave it alone" and an
        // explicit null as the revocation, so an emptied group has to be `null`.
        expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({ allowed_tools: null })
    })

    it('sends null for a skill that declares nothing, even on an unrelated save', async () => {
        const wrapper = mountDesk({ tools: makeTools(), skill: makeSkill({ allowed_tools: null }) })
        await wrapper.get('[data-test="field-description"]').setValue('Rewritten.')
        await wrapper.get('[data-test="desk-save"]').trigger('click')
        expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({ allowed_tools: null })
    })

    it('re-sends a malformed value byte for byte, because the plugin does not judge it', async () => {
        // A comma, an FQCN and a doubled space: outside the grammar, so core reports
        // it, and the editor's job is to show it rather than tidy it. Trimming or
        // re-serialising here would rewrite a value the server is entitled to reject.
        const stored = 'read_email,  Spora\\Tools\\ReadEmailTool  '
        const wrapper = mountDesk({ tools: makeTools(), skill: makeSkill({ allowed_tools: stored }) })
        await wrapper.get('[data-test="field-description"]').setValue('Rewritten.')
        await wrapper.get('[data-test="desk-save"]').trigger('click')

        expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({ allowed_tools: stored })
    })

    it('marks the desk dirty when only this field changes', async () => {
        // Without it in `draft`, checking a box would leave the pill reading
        // "saved" and the Save button disabled, and the edit would be lost on
        // navigate-away with no prompt.
        const wrapper = withTools({ skill: makeSkill({ allowed_tools: 'read_url' }) })
        expect(wrapper.get('[data-test="desk-state"]').text()).toBe('saved')

        await wrapper.get('[data-test="tool-option-agent"] input').setValue(true)

        expect(wrapper.get('[data-test="desk-state"]').text()).toBe('unsaved changes')
        expect(wrapper.get('[data-test="desk-save"]').attributes('disabled')).toBeUndefined()
    })

    it('hides the group while a sidecar is open, like the rest of the frontmatter', async () => {
        const wrapper = withTools({ fileContents: { 'examples/invoice.md': '# Invoice' } })
        await flushPromises()
        await wrapper.get('[data-test="rail-file-examples/invoice.md"]').trigger('click')

        // It is SKILL.md's frontmatter, so it belongs to SKILL.md and nothing else.
        expect(wrapper.find('[data-test="field-allowed-tools"]').exists()).toBe(false)
    })

    it('cannot be edited on a shipped skill, which has no write path', () => {
        const wrapper = withTools({ readOnly: true })
        for (const box of boxes(wrapper)) {
            expect(box.attributes('disabled')).toBeDefined()
        }
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

    it('routes a finding on the hyphenated `allowed-tools` path to the field, not the banner', () => {
        // Core's validator reports the *frontmatter* key, `allowed-tools`, while the
        // editor's field is the underscored API name. The rewrite in `fieldForPath`
        // is what bridges the two; without it this finding falls through to the
        // banner and the field shows no error while the server refuses the save.
        const wrapper = mountDesk({
            validationErrors: [makeValidationEntry({ code: 'ALLOWED_TOOLS_INVALID', message: 'not a space-separated string', path: 'allowed-tools' })],
        })
        const field = wrapper.get('[data-test="field-allowed-tools"]')
        // On the inputs, not the `<fieldset>`: the fieldset is not an ARIA widget, so
        // an invalid state on it reaches no assistive technology.
        for (const box of field.findAll('input[type="checkbox"]')) {
            expect(box.attributes('aria-invalid')).toBe('true')
        }
        expect(field.findAll('[data-test="field-error"]')).toHaveLength(1)
        expect(wrapper.find('[data-test="validation-banner"]').exists()).toBe(false)
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

describe('SkillDesk → what surrounds the editor', () => {
    const layout = (wrapper: ReturnType<typeof mountDesk>) => {
        const html = wrapper.html()
        return {
            headline: html.indexOf('data-test="desk-title"'),
            rail: html.indexOf('data-test="file-rail"'),
            openFile: html.indexOf('data-test="open-file"'),
        }
    }

    it('puts the skill headline above the rail as well as the editor', () => {
        // It used to sit inside the editor column, which read as though the skill
        // belonged to whichever file happened to be open.
        const positions = layout(mountDesk())
        expect(positions.headline).toBeGreaterThan(-1)
        expect(positions.headline).toBeLessThan(positions.rail)
    })

    it('names the open file on the right, where that file’s controls are', async () => {
        const wrapper = mountDesk({
            fileContents: { 'examples/invoice.md': '# Invoice' },
        })
        await flushPromises()

        expect(wrapper.get('[data-test="open-file-name"]').text()).toBe('SKILL.md')

        await wrapper.get('[data-test="rail-file-examples/invoice.md"]').trigger('click')
        expect(wrapper.get('[data-test="open-file-name"]').text()).toBe('examples/invoice.md')
    })

    it('offers the rename next to the open file name, as well as on the rail row', async () => {
        const wrapper = mountDesk({
            fileContents: { 'examples/invoice.md': '# Invoice' },
        })
        await flushPromises()
        // SKILL.md cannot be renamed, so neither control is offered for it.
        expect(wrapper.find('[data-test="open-file-rename"]').exists()).toBe(false)

        await wrapper.get('[data-test="rail-file-examples/invoice.md"]').trigger('click')

        // Both, deliberately: the rail says which file is open, this says what it is
        // called and what can be done to it.
        expect(wrapper.find('[data-test="rename-file"]').exists()).toBe(true)
        expect(wrapper.find('[data-test="open-file-rename"]').exists()).toBe(true)

        // And the one here actually opens the dialog.
        await wrapper.get('[data-test="open-file-rename"]').trigger('click')
        expect(wrapper.find('[data-test="file-dialog"]').exists()).toBe(true)
    })

    it('does not offer the rename on a shipped skill, which cannot be written', async () => {
        const wrapper = mountDesk({
            skill: makeSkill(),
            readOnly: true,
            fileContents: { 'examples/invoice.md': '# Invoice' },
        })
        await flushPromises()
        await wrapper.get('[data-test="rail-file-examples/invoice.md"]').trigger('click')

        expect(wrapper.find('[data-test="open-file-rename"]').exists()).toBe(false)
        expect(wrapper.find('[data-test="remove-sidecar"]').exists()).toBe(false)
        expect(wrapper.find('[data-test="sidecar-unavailable"]').exists()).toBe(true)
    })

    it('shows no open-file bar controls when SKILL.md is the open file', () => {
        const wrapper = mountDesk()
        expect(wrapper.find('[data-test="open-file"]').exists()).toBe(true)
        expect(wrapper.find('[data-test="remove-sidecar"]').exists()).toBe(false)
    })
})
