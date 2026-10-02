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
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SkillDesk from '../../src/components/SkillDesk.vue'
import SourceEditor from '../../src/components/SourceEditor.vue'
import { makeSkill, makeValidationEntry } from '../fixtures'
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

    it('can still be folded away, and says so on the toggle', () => {
        const wrapper = mountDesk()
        const toggle = wrapper.get('[data-test="frontmatter-toggle"]')
        expect(toggle.text()).toContain('SKILL.md frontmatter')
        expect(toggle.text()).toContain('an agent matches')
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
