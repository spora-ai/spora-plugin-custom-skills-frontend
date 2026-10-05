/**
 * `SkillViewer` — the read-only inspector. Exploring a skill must cost nothing:
 * duplicating in order to *look* writes a row, consumes a name and needs deleting
 * again. So these assert that it renders the skill faithfully and that it has no
 * path by which reading can mutate.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SkillViewer from '../../src/components/SkillViewer.vue'
import type { PreShippedSkillDetail, CustomSkillResource } from '../../src/types'

function makeSkill(overrides: Partial<CustomSkillResource> = {}): CustomSkillResource {
    return {
        id: 1,
        principal_id: 7,
        name: 'invoice-drafting',
        slug: 'invoice-drafting',
        description: 'How to draft an invoice.',
        license: 'MIT',
        compatibility: 'spora>=0.29',
        allowed_tools: 'agent read_url',
        metadata: { tier: 'pro' },
        body: '# Steps\n\n1. Look up the customer.',
        body_bytes: 40,
        provenance: 'human',
        created_by_user_id: 3,
        updated_by_user_id: 3,
        created_at: '2026-09-30 10:00:00',
        updated_at: '2026-09-30 14:02:00',
        files: [
            { path: 'SKILL.md', bytes: 40 },
            { path: 'examples/invoice.md', bytes: 120 },
        ],
        has_previous: false,
        previous_at: null,
        previous_by: null,
        warnings: [],
        warning_count: 0,
        ...overrides,
    }
}

function makeShipped(overrides: Partial<PreShippedSkillDetail> = {}): PreShippedSkillDetail {
    return {
        name: 'typst',
        description: 'Typeset documents.',
        license: 'Apache-2.0',
        compatibility: null,
        metadata: {},
        // Always on the wire, and a shipped skill's declaration is shown here as a
        // fact: it is the only place a reader of a shipped skill can see it.
        allowed_tools: 'typst_compile',
        body: '# Typst\n\nRender with typst.',
        body_bytes: 28,
        files: [
            { path: 'SKILL.md', bytes: 28 },
            { path: 'templates/report.typ', bytes: 900 },
        ],
        warnings: [],
        ...overrides,
    }
}

function mountViewer(props: Record<string, unknown>) {
    return mount(SkillViewer, { props: props as never })
}

describe('SkillViewer', () => {
    it('shows the name, description and facts of a custom skill', () => {
        const wrapper = mountViewer({ skill: makeSkill() })
        expect(wrapper.get('[data-test="viewer-title"]').text()).toBe('invoice-drafting')
        expect(wrapper.get('[data-test="viewer-description"]').text()).toContain('draft an invoice')
        const facts = wrapper.get('[data-test="viewer-facts"]').text()
        expect(facts).toContain('MIT')
        expect(facts).toContain('spora>=0.29')
        expect(facts).toContain('tier: pro')
    })

    it('shows the declared tools as a fact, and omits the row when none are declared', () => {
        // A declaration with no row is a declaration the reader cannot see, and this
        // is the only surface that shows one for a shipped skill.
        expect(mountViewer({ skill: makeSkill() }).get('[data-test="viewer-facts"]').text())
            .toContain('agent read_url')

        const bare = makeSkill({ license: null, compatibility: null, allowed_tools: null, metadata: {} })
        expect(mountViewer({ skill: bare }).find('[data-test="viewer-facts"]').exists()).toBe(false)
    })

    it('omits absent facts rather than rendering blank rows', () => {
        const wrapper = mountViewer({
            skill: makeSkill({ license: null, compatibility: null, allowed_tools: null, metadata: {} }),
        })
        expect(wrapper.find('[data-test="viewer-facts"]').exists()).toBe(false)
    })

    it('previews JSON reindented, instead of showing it as unformatted text', async () => {
        // Markdown used to be the only rendered format, so a JSON sidecar read as
        // "cannot be previewed" even though the panel had its contents.
        const wrapper = mountViewer({
            skill: makeSkill({
                files: [{ path: 'SKILL.md', bytes: 10 }, { path: 'assets/data.json', bytes: 20 }],
            }),
            fileContents: { 'assets/data.json': '{"a":1,"b":[2,3]}' },
        })
        await wrapper.get('[data-test="viewer-rail-file-assets/data.json"]').trigger('click')

        const shown = wrapper.get('[data-test="viewer-formatted"]').text()
        expect(shown).toContain('"a": 1')
        expect(shown).toContain('"b": [')
        expect(wrapper.find('[data-test="viewer-json-invalid"]').exists()).toBe(false)
    })

    it('shows malformed JSON as written, and says why', async () => {
        // A half-written config is exactly what an operator opens this panel to
        // check, so it must not be presented as though the reformatting worked.
        const wrapper = mountViewer({
            skill: makeSkill({
                files: [{ path: 'SKILL.md', bytes: 10 }, { path: 'data.json', bytes: 20 }],
            }),
            fileContents: { 'data.json': '{"a": 1,' },
        })
        await wrapper.get('[data-test="viewer-rail-file-data.json"]').trigger('click')

        expect(wrapper.get('[data-test="viewer-json-invalid"]').text()).toContain('not valid JSON')
        // Falls back to the source view rather than showing nothing.
        expect(wrapper.find('[data-test="source-editor"]').exists()).toBe(true)
    })

    it('previews a non-markdown text file as source, not as prose', async () => {
        const wrapper = mountViewer({
            skill: makeSkill({
                files: [{ path: 'SKILL.md', bytes: 10 }, { path: 'scripts/extract.py', bytes: 20 }],
            }),
            fileContents: { 'scripts/extract.py': 'print("hi")\n' },
        })
        await wrapper.get('[data-test="viewer-rail-file-scripts/extract.py"]').trigger('click')

        // Markdown would turn this into a paragraph of code.
        expect(wrapper.find('[data-testid="md-preview-stub"]').exists()).toBe(false)
        expect(wrapper.find('[data-test="source-editor"]').exists()).toBe(true)
    })

    it('says a binary file cannot be shown, instead of rendering mojibake', async () => {
        const wrapper = mountViewer({
            skill: makeSkill({
                files: [{ path: 'SKILL.md', bytes: 10 }, { path: 'assets/logo.svg', bytes: 20 }],
            }),
            // A NUL byte: decisive, and a plausible thing to find in a binary asset
            // that came through a text field.
            fileContents: { 'assets/logo.svg': 'PNG\u0000\u0000binary' },
        })
        await wrapper.get('[data-test="viewer-rail-file-assets/logo.svg"]').trigger('click')

        expect(wrapper.get('[data-test="viewer-binary"]').text()).toContain('not a text format')
        expect(wrapper.find('[data-test="source-editor"]').exists()).toBe(false)
    })

    it('lists the body and every sidecar in the rail, under its folder', () => {
        const wrapper = mountViewer({ skill: makeSkill(), fileContents: { 'examples/invoice.md': '# Example' } })
        expect(wrapper.get('[data-test="viewer-tab-entry"]').text()).toContain('SKILL.md')
        // The structure is the point: a flat strip lost the folder and ran out of
        // room for a skill with more than a couple of sidecars.
        expect(wrapper.find('[data-test="viewer-rail-folder-examples"]').exists()).toBe(true)
        expect(wrapper.find('[data-test="viewer-rail-file-examples/invoice.md"]').exists()).toBe(true)
        // A leaf shows its basename; the folder row is what carries the prefix.
        expect(wrapper.get('[data-test="viewer-rail-file-examples/invoice.md"]').text()).toContain('invoice.md')
    })

    it('collapses a folder in the rail, the way the desk does', async () => {
        const wrapper = mountViewer({ skill: makeSkill(), fileContents: { 'examples/invoice.md': '# Example' } })
        expect(wrapper.find('[data-test="viewer-rail-file-examples/invoice.md"]').exists()).toBe(true)
        await wrapper.get('[data-test="viewer-rail-folder-examples"]').trigger('click')
        expect(wrapper.find('[data-test="viewer-rail-file-examples/invoice.md"]').exists()).toBe(false)
        // The folder itself stays, or there would be no way back.
        expect(wrapper.find('[data-test="viewer-rail-folder-examples"]').exists()).toBe(true)
    })

    it('shows the body content for the entry tab', () => {
        const wrapper = mountViewer({ skill: makeSkill(), fileContents: {} })
        expect(wrapper.get('[data-test="viewer-content"]').text()).toContain('Look up the customer')
    })

    it('carries the hand-written preview typography class', () => {
        // `src/style.css` scopes `.md-preview` by hand, so the class has to reach
        // the rendered node or the preview is unstyled prose.
        const wrapper = mountViewer({ skill: makeSkill() })
        expect(wrapper.get('[data-testid="md-preview-stub"]').classes()).toContain('md-preview')
    })

    it('switches to a sidecar tab and shows its fetched content', async () => {
        const wrapper = mountViewer({ skill: makeSkill(), fileContents: { 'examples/invoice.md': '# Example body' } })
        await wrapper.get('[data-test="viewer-rail-file-examples/invoice.md"]').trigger('click')
        expect(wrapper.get('[data-test="viewer-content"]').text()).toContain('Example body')
    })

    it('resets to SKILL.md when a different skill is inspected', async () => {
        const wrapper = mountViewer({ skill: makeSkill(), fileContents: { 'examples/invoice.md': '# Example' } })
        await wrapper.get('[data-test="viewer-rail-file-examples/invoice.md"]').trigger('click')
        await wrapper.setProps({ skill: makeSkill({ name: 'other', files: [{ path: 'SKILL.md', bytes: 10 }] }) })
        // The previously-open file does not exist on the new skill, so the
        // inspector must not sit on a file it does not have.
        expect(wrapper.get('[data-test="viewer-tab-entry"]').classes()).toContain('ring-1')
    })

    it('marks a shipped skill read-only and offers Duplicate, not Edit', () => {
        const wrapper = mountViewer({ shipped: makeShipped() })
        expect(wrapper.get('[data-test="viewer-readonly-badge"]').text()).toContain('read-only')
        expect(wrapper.find('[data-test="viewer-edit"]').exists()).toBe(false)
        expect(wrapper.find('[data-test="viewer-duplicate"]').exists()).toBe(true)
    })

    it('offers Edit for a custom skill and not Duplicate', () => {
        const wrapper = mountViewer({ skill: makeSkill() })
        expect(wrapper.find('[data-test="viewer-edit"]').exists()).toBe(true)
        expect(wrapper.find('[data-test="viewer-duplicate"]').exists()).toBe(false)
    })

    it('says a file the host would not serve cannot be shown, instead of a blank pane', async () => {
        const wrapper = mountViewer({
            shipped: makeShipped(),
            unavailablePaths: ['templates/report.typ'],
        })
        await wrapper.get('[data-test="viewer-rail-file-templates/report.typ"]').trigger('click')
        expect(wrapper.get('[data-test="viewer-contents-unavailable"]').text())
            .toContain('templates/report.typ')
        expect(wrapper.find('[data-test="viewer-content"]').exists()).toBe(false)
    })

    it('asks for a sidecar when it is opened, and shows it once loaded', async () => {
        const wrapper = mountViewer({ shipped: makeShipped() })
        await wrapper.get('[data-test="viewer-rail-file-templates/report.typ"]').trigger('click')
        expect(wrapper.emitted('loadFile')?.[0]).toEqual(['typst', 'templates/report.typ'])

        await wrapper.setProps({ fileContents: { 'templates/report.typ': '#let x = 1' } })
        expect(wrapper.find('[data-test="source-editor"]').exists()).toBe(true)
        expect(wrapper.find('[data-test="viewer-contents-loading"]').exists()).toBe(false)
    })

    it('shows a pending line rather than an empty editor while a read is in flight', async () => {
        const wrapper = mountViewer({ shipped: makeShipped() })
        await wrapper.get('[data-test="viewer-rail-file-templates/report.typ"]').trigger('click')
        const pending = wrapper.get('[data-test="viewer-contents-loading"]')
        expect(pending.text()).toContain('templates/report.typ')
        expect(pending.text()).toContain('Reading')
        expect(wrapper.find('[data-test="viewer-content"]').exists()).toBe(false)
    })

    it('does not ask twice for the same path, so a failed read cannot loop', async () => {
        const wrapper = mountViewer({
            shipped: makeShipped(),
            unavailablePaths: ['templates/report.typ'],
        })
        const tab = wrapper.get('[data-test="viewer-rail-file-templates/report.typ"]')
        await tab.trigger('click')
        await tab.trigger('click')
        await wrapper.get('[data-test="viewer-tab-entry"]').trigger('click')
        await tab.trigger('click')

        const asked = (wrapper.emitted('loadFile') ?? []).map(([, path]) => path)
        expect(asked.filter((p) => p === 'templates/report.typ')).toHaveLength(1)
    })

    it('does not ask for the entry file, whose contents came with the detail', async () => {
        const wrapper = mountViewer({ shipped: makeShipped() })
        await wrapper.get('[data-test="viewer-rail-file-templates/report.typ"]').trigger('click')
        await wrapper.get('[data-test="viewer-tab-entry"]').trigger('click')

        const asked = (wrapper.emitted('loadFile') ?? []).map(([, path]) => path)
        expect(asked).not.toContain('SKILL.md')
    })

    it('surfaces validator warnings with their code', () => {
        const wrapper = mountViewer({
            skill: makeSkill({
                warnings: [{ code: 'BODY_SOFT_BYTE_LIMIT', severity: 'warning', message: 'Body is long.' }],
            }),
        })
        expect(wrapper.get('[data-test="viewer-warnings"]').text()).toContain('BODY_SOFT_BYTE_LIMIT')
    })

    it('emits the skill name for edit', async () => {
        const wrapper = mountViewer({ skill: makeSkill() })
        await wrapper.get('[data-test="viewer-edit"]').trigger('click')
        expect(wrapper.emitted('edit')?.[0]).toEqual(['invoice-drafting'])
    })

    it('offers no way to close, because the page above carries the back-link', () => {
        // A page body with a dismiss button reads as a dialog, and the second route
        // out of a page is a step that buys nothing — the back-link already goes
        // where `close` used to send it.
        const wrapper = mountViewer({ skill: makeSkill() })
        expect(wrapper.find('[data-test="viewer-close"]').exists()).toBe(false)
        expect(wrapper.find('[data-test="viewer-dismiss"]').exists()).toBe(false)
        expect(wrapper.emitted('close')).toBeUndefined()
    })

    it('emits duplicate for a shipped skill', async () => {
        const wrapper = mountViewer({ shipped: makeShipped() })
        await wrapper.get('[data-test="viewer-duplicate"]').trigger('click')
        expect(wrapper.emitted('duplicate')?.[0]).toEqual(['typst'])
    })

    it('exposes no write control at all — reading cannot mutate', () => {
        // Structural: a form, input or submit control anywhere in a read-only
        // inspector would be a path from "just looking" to a mutation.
        const wrapper = mountViewer({ skill: makeSkill(), fileContents: { 'examples/invoice.md': '# Example' } })
        expect(wrapper.find('form').exists()).toBe(false)
        expect(wrapper.find('input').exists()).toBe(false)
        expect(wrapper.find('textarea').exists()).toBe(false)
        expect(wrapper.find('[data-test="editor-save"]').exists()).toBe(false)
    })
})
