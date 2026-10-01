/**
 * `SkillEditor` — the validation feedback contract. A bad write is a 422
 * `SKILL_INVALID` carrying a `ValidationResult` array, and two things must happen
 * with it: an error anchored to a `path` renders **under that field**, and warnings
 * (plus any error no field claims) render in a banner, so nothing is dropped.
 *
 * The rest pins the lifecycle rules that rendering depends on: `name` is read-only
 * on edit, restore appears only when `has_previous`, and the provenance line comes
 * from `provenance` + `updated_by_user_id`.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SkillEditor from '../../src/components/SkillEditor.vue'
import { makeSkill, makeValidationEntry } from '../fixtures'

function mountEditor(props: Record<string, unknown> = {}) {
    return mount(SkillEditor, { props })
}

describe('SkillEditor → validation errors render inline per field', () => {
    it('puts a name error under the name input, not in a banner', () => {
        const wrapper = mountEditor({
            skill: null,
            validationErrors: [
                makeValidationEntry({ code: 'NAME_INVALID', message: 'lowercase kebab-case only', path: 'name' }),
            ],
        })
        const nameField = wrapper.get('[data-test="field-name"]')
        expect(nameField.attributes('aria-invalid')).toBe('true')
        const fieldErrors = wrapper.findAll('[data-test="field-error"]')
        expect(fieldErrors).toHaveLength(1)
        expect(fieldErrors[0]?.text()).toContain('lowercase kebab-case only')
        expect(wrapper.find('[data-test="validation-banner"]').exists()).toBe(false)
    })

    it('maps the validator’s hyphenated `allowed-tools` path onto the Allowed tools field', () => {
        const wrapper = mountEditor({
            skill: null,
            validationErrors: [
                makeValidationEntry({ code: 'TOOL_UNKNOWN', message: 'unknown tool "send_emai"', path: 'allowed-tools' }),
            ],
        })
        const field = wrapper.get('[data-test="field-allowed-tools"]')
        expect(field.attributes('aria-invalid')).toBe('true')
        expect(wrapper.find('[data-test="validation-banner"]').exists()).toBe(false)
    })

    it('attaches body, license, compatibility and description errors to their own fields', () => {
        const wrapper = mountEditor({
            skill: null,
            validationErrors: [
                makeValidationEntry({ code: 'BODY_TOO_SHORT', message: 'body too short', path: 'body' }),
                makeValidationEntry({ code: 'LICENSE_INVALID', message: 'bad license', path: 'license' }),
                makeValidationEntry({ code: 'COMPAT_UNPARSEABLE', message: 'bad constraint', path: 'compatibility' }),
                makeValidationEntry({ code: 'DESCRIPTION_TOO_LONG', message: 'over 1024 chars', path: 'description' }),
            ],
        })
        expect(wrapper.findAll('[data-test="field-error"]')).toHaveLength(4)
        expect(wrapper.get('[data-test="field-license"]').attributes('aria-invalid')).toBe('true')
        expect(wrapper.get('[data-test="field-compatibility"]').attributes('aria-invalid')).toBe('true')
        expect(wrapper.get('[data-test="field-description"]').attributes('aria-invalid')).toBe('true')
    })

    it('does not mark a field invalid when the finding belongs elsewhere', () => {
        const wrapper = mountEditor({
            skill: null,
            validationErrors: [makeValidationEntry({ message: 'name bad', path: 'name' })],
        })
        expect(wrapper.get('[data-test="field-license"]').attributes('aria-invalid')).toBe('false')
        expect(wrapper.get('[data-test="field-description"]').attributes('aria-invalid')).toBe('false')
    })
})

describe('SkillEditor → warnings render as a banner', () => {
    it('lists validator warnings with their code and path', () => {
        const wrapper = mountEditor({
            skill: null,
            validationErrors: [
                makeValidationEntry({
                    code: 'BODY_SOFT_BYTE_LIMIT',
                    severity: 'warning',
                    message: 'Body is above the soft byte limit.',
                    path: 'body',
                }),
            ],
        })
        const banner = wrapper.get('[data-test="validation-banner"]')
        expect(banner.text()).toContain('BODY_SOFT_BYTE_LIMIT')
        expect(banner.text()).toContain('(body)')
        expect(banner.text()).toContain('Body is above the soft byte limit.')
        expect(wrapper.findAll('[data-test="field-error"]')).toHaveLength(0)
    })

    it('shows warnings the stored skill already carries, even on a clean write', () => {
        const wrapper = mountEditor({
            skill: makeSkill({
                warning_count: 1,
                warnings: [{ code: 'TOO_MANY_FILES', severity: 'warning', message: 'nearing the file cap' }],
            }),
        })
        const banner = wrapper.get('[data-test="validation-banner"]')
        expect(banner.text()).toContain('Saved with warnings')
        expect(banner.text()).toContain('TOO_MANY_FILES')
    })

    it('an error with no recognisable path still reaches the operator', () => {
        // `metadata` is a JSON blob with no message slot — dropping the finding
        // would leave a rejected save with nothing to act on.
        const wrapper = mountEditor({
            skill: null,
            validationErrors: [makeValidationEntry({ code: 'METADATA_INVALID', message: 'tier must be a string', path: 'metadata' })],
        })
        const banner = wrapper.get('[data-test="validation-banner"]')
        expect(banner.text()).toContain('METADATA_INVALID')
        expect(banner.text()).toContain('tier must be a string')
    })

    it('renders no banner when there is nothing to report', () => {
        const wrapper = mountEditor({ skill: makeSkill() })
        expect(wrapper.find('[data-test="validation-banner"]').exists()).toBe(false)
    })
})

describe('SkillEditor → lifecycle affordances', () => {
    it('shows “Last edited by agent · 14:02” for agent provenance', () => {
        const wrapper = mountEditor({ skill: makeSkill({ provenance: 'agent', updated_at: '2026-09-30 14:02:00' }) })
        expect(wrapper.get('[data-test="editor-last-edited"]').text()).toBe('Last edited by agent · 14:02')
    })

    it('shows “Last edited by you” when the operator wrote it themselves', () => {
        const wrapper = mountEditor({ skill: makeSkill({ provenance: 'human' }) })
        expect(wrapper.get('[data-test="editor-last-edited"]').text()).toBe('Last edited by you · 14:02')
    })

    it('attributes a human write by a different user to a teammate', () => {
        const wrapper = mountEditor({
            skill: makeSkill({ provenance: 'human', created_by_user_id: 3, updated_by_user_id: 9 }),
        })
        expect(wrapper.get('[data-test="editor-last-edited"]').text()).toContain('Last edited by a teammate')
    })

    it('offers restore only when the server holds a previous snapshot', () => {
        const withPrevious = mountEditor({ skill: makeSkill({ has_previous: true }) })
        expect(withPrevious.find('[data-test="editor-restore"]').exists()).toBe(true)

        const withoutPrevious = mountEditor({ skill: makeSkill({ has_previous: false }) })
        expect(withoutPrevious.find('[data-test="editor-restore"]').exists()).toBe(false)
    })

    it('emits restore with the skill name', async () => {
        const wrapper = mountEditor({ skill: makeSkill({ has_previous: true }) })
        await wrapper.get('[data-test="editor-restore"]').trigger('click')
        expect(wrapper.emitted('restore')?.[0]).toEqual(['invoice-drafting'])
    })

    it('locks the slug on edit and shows why', () => {
        const wrapper = mountEditor({ skill: makeSkill() })
        expect(wrapper.get('[data-test="field-name"]').attributes('readonly')).toBeDefined()
        expect(wrapper.text()).toContain('rename is rejected with 422')
    })

    it('leaves the slug editable on create', () => {
        const wrapper = mountEditor({ skill: null })
        expect(wrapper.get('[data-test="field-name"]').attributes('readonly')).toBeUndefined()
    })
})

describe('SkillEditor → save payload', () => {
    it('creates with the name and parses metadata JSON', async () => {
        const wrapper = mountEditor({ skill: null })
        await wrapper.get('[data-test="field-name"]').setValue('invoice-drafting')
        await wrapper.get('[data-test="field-description"]').setValue('How to draft an invoice.')
        await wrapper.get('[data-test="field-metadata"]').setValue('{"tier":"pro"}')
        await wrapper.get('[data-test="field-body"]').setValue('# Steps')
        await wrapper.get('form').trigger('submit')
        expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({
            name: 'invoice-drafting',
            description: 'How to draft an invoice.',
            body: '# Steps',
            license: null,
            compatibility: null,
            allowed_tools: null,
            metadata: { tier: 'pro' },
            files: {},
        })
    })

    it('refuses to submit unparseable metadata with a field-level message', async () => {
        const wrapper = mountEditor({ skill: null })
        await wrapper.get('[data-test="field-name"]').setValue('ok')
        await wrapper.get('[data-test="field-metadata"]').setValue('{not json')
        await wrapper.get('form').trigger('submit')
        expect(wrapper.emitted('save')).toBeUndefined()
        expect(wrapper.get('[data-test="field-metadata"]').attributes('aria-invalid')).toBe('true')
        expect(wrapper.get('[data-test="field-error"]').text()).toContain('not valid JSON')
    })

    it('rejects a JSON array — the field is an object, not a list', async () => {
        const wrapper = mountEditor({ skill: null })
        await wrapper.get('[data-test="field-name"]').setValue('ok')
        await wrapper.get('[data-test="field-metadata"]').setValue('[1,2]')
        await wrapper.get('form').trigger('submit')
        expect(wrapper.get('[data-test="field-error"]').text()).toContain('must be a JSON object')
    })

    it('updates without a name — the contract rejects a rename', async () => {
        const wrapper = mountEditor({ skill: makeSkill() })
        await wrapper.get('[data-test="field-description"]').setValue('Rewritten.')
        await wrapper.get('form').trigger('submit')
        const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, unknown>
        expect(payload).not.toHaveProperty('name')
        expect(payload['description']).toBe('Rewritten.')
    })

    it('asks the page for sidecar contents on open so an edit does not blank them', () => {
        const wrapper = mountEditor({ skill: makeSkill() })
        expect(wrapper.emitted('loadFiles')?.[0]).toEqual(['invoice-drafting'])
    })

    it('does not ask for sidecars when the skill has none', () => {
        const wrapper = mountEditor({ skill: makeSkill({ files: [{ path: 'SKILL.md', bytes: 940 }] }) })
        expect(wrapper.emitted('loadFiles')).toBeUndefined()
    })

    it('opens on SKILL.md and tabs to a sidecar, sending the path→content map', async () => {
        // Sidecars are tabs into ONE editor, so "edit this sidecar" means selecting
        // its tab first.
        const wrapper = mountEditor({ skill: makeSkill() })

        // The path input exists only for the *active* sidecar, so landing on
        // SKILL.md means there is nothing to rename yet.
        expect(wrapper.find('[data-test="sidecar-path"]').exists()).toBe(false)
        expect(wrapper.findAll('[data-test="editor-tab-file"]')).toHaveLength(1)

        await wrapper.get('[data-test="editor-tab-file"]').trigger('click')
        expect((wrapper.get('[data-test="sidecar-path"]').element as HTMLInputElement).value)
            .toBe('examples/invoice.md')

        await wrapper.get('[data-test="field-body"]').setValue('# Example')
        await wrapper.get('form').trigger('submit')
        const payload = wrapper.emitted('save')?.[0]?.[0] as { files: Record<string, string> }
        expect(payload.files).toEqual({ 'examples/invoice.md': '# Example' })
    })

    it('writes each sidecar to its own tab, not into the body', async () => {
        // `activeContent` is one computed over two stores, so a sidecar write
        // landing in `body` would be silent: the body looks edited, the file is
        // empty, the save is wrong.
        const wrapper = mountEditor({ skill: makeSkill() })

        await wrapper.get('[data-test="field-body"]').setValue('# SKILL body')
        await wrapper.get('[data-test="editor-tab-file"]').trigger('click')
        await wrapper.get('[data-test="field-body"]').setValue('# Sidecar body')

        await wrapper.get('form').trigger('submit')
        const payload = wrapper.emitted('save')?.[0]?.[0] as {
            body: string
            files: Record<string, string>
        }
        expect(payload.body).toBe('# SKILL body')
        expect(payload.files).toEqual({ 'examples/invoice.md': '# Sidecar body' })
    })

    it('gives a new sidecar a usable path and puts the cursor in it', async () => {
        // A blank path is rejected server-side, and the click has to land
        // somewhere visible.
        const wrapper = mountEditor({ skill: makeSkill() })
        await wrapper.get('[data-test="add-sidecar"]').trigger('click')

        expect(wrapper.findAll('[data-test="editor-tab-file"]')).toHaveLength(2)
        const added = wrapper.findAll('[data-test="editor-tab-file"]')[1]
        expect(added?.text()).toContain('notes-2.md')
        expect(wrapper.find('[data-test="sidecar-path"]').exists()).toBe(true)
    })

    it('renaming the active sidecar moves its tab and keeps the content', async () => {
        const wrapper = mountEditor({ skill: makeSkill() })
        await wrapper.get('[data-test="editor-tab-file"]').trigger('click')
        await wrapper.get('[data-test="field-body"]').setValue('# Example')

        await wrapper.get('[data-test="sidecar-path"]').setValue('examples/renamed.md')
        await wrapper.get('form').trigger('submit')

        const payload = wrapper.emitted('save')?.[0]?.[0] as { files: Record<string, string> }
        // The tab is keyed on the path, so a rename that dropped the content with
        // it would blank the file on save.
        expect(payload.files).toEqual({ 'examples/renamed.md': '# Example' })
    })

    it('removes the active sidecar and returns to SKILL.md', async () => {
        const wrapper = mountEditor({ skill: makeSkill() })
        await wrapper.get('[data-test="editor-tab-file"]').trigger('click')
        await wrapper.get('[data-test="remove-sidecar"]').trigger('click')

        expect(wrapper.find('[data-test="sidecar-path"]').exists()).toBe(false)
        expect(wrapper.find('[data-test="sidecars-empty"]').exists()).toBe(true)

        await wrapper.get('form').trigger('submit')
        const payload = wrapper.emitted('save')?.[0]?.[0] as { files: Record<string, string> }
        expect(payload.files).toEqual({})
    })

    it('explains the empty sidecar state instead of rendering a blank box', () => {
        const wrapper = mountEditor({ skill: makeSkill({ files: [{ path: 'SKILL.md', bytes: 940 }] }) })
        expect(wrapper.get('[data-test="sidecars-empty"]').text()).toContain('replaced wholesale on save')
    })

    it('blocks submit while saving', () => {
        const wrapper = mountEditor({ skill: null, saving: true })
        expect(wrapper.get('[data-test="editor-save"]').attributes('disabled')).toBeDefined()
    })
})
