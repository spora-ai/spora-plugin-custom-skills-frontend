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
        allowed_tools: 'read_email, send_email',
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
        expect(facts).toContain('read_email')
        expect(facts).toContain('tier: pro')
    })

    it('omits absent facts rather than rendering blank rows', () => {
        const wrapper = mountViewer({
            skill: makeSkill({ license: null, compatibility: null, allowed_tools: null, metadata: {} }),
        })
        expect(wrapper.find('[data-test="viewer-facts"]').exists()).toBe(false)
    })

    it('lists the body and every sidecar as a tab', () => {
        const wrapper = mountViewer({ skill: makeSkill(), fileContents: { 'examples/invoice.md': '# Example' } })
        expect(wrapper.get('[data-test="viewer-tab-entry"]').text()).toContain('SKILL.md')
        const tabs = wrapper.findAll('[data-test="viewer-tab-file"]')
        expect(tabs).toHaveLength(1)
        // Nested paths are labelled by basename so the bar cannot overflow.
        expect(tabs[0]?.text()).toContain('invoice.md')
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
        await wrapper.get('[data-test="viewer-tab-file"]').trigger('click')
        expect(wrapper.get('[data-test="viewer-content"]').text()).toContain('Example body')
    })

    it('resets to SKILL.md when a different skill is inspected', async () => {
        const wrapper = mountViewer({ skill: makeSkill(), fileContents: { 'examples/invoice.md': '# Example' } })
        await wrapper.get('[data-test="viewer-tab-file"]').trigger('click')
        await wrapper.setProps({ skill: makeSkill({ name: 'other', files: [{ path: 'SKILL.md', bytes: 10 }] }) })
        // The previously-open tab does not exist on the new skill, so the
        // inspector must not sit on a file it does not have.
        expect(wrapper.get('[data-test="viewer-tab-entry"]').classes()).toContain('border-primary')
    })

    it('marks a shipped skill read-only and offers Duplicate, not Edit', () => {
        const wrapper = mountViewer({ shipped: makeShipped(), contentsUnavailable: true })
        expect(wrapper.get('[data-test="viewer-readonly-badge"]').text()).toContain('read-only')
        expect(wrapper.find('[data-test="viewer-edit"]').exists()).toBe(false)
        expect(wrapper.find('[data-test="viewer-duplicate"]').exists()).toBe(true)
    })

    it('offers Edit for a custom skill and not Duplicate', () => {
        const wrapper = mountViewer({ skill: makeSkill() })
        expect(wrapper.find('[data-test="viewer-edit"]').exists()).toBe(true)
        expect(wrapper.find('[data-test="viewer-duplicate"]').exists()).toBe(false)
    })

    it('states that shipped sidecar contents are unavailable instead of showing a blank pane', async () => {
        // The host returns files as {path, bytes} with no per-file read endpoint,
        // so this state is real. An empty editor here would look like a bug.
        const wrapper = mountViewer({ shipped: makeShipped(), contentsUnavailable: true })
        await wrapper.get('[data-test="viewer-tab-file"]').trigger('click')
        expect(wrapper.get('[data-test="viewer-contents-unavailable"]').text())
            .toContain('templates/report.typ')
        expect(wrapper.find('[data-test="viewer-content"]').exists()).toBe(false)
    })

    it('surfaces validator warnings with their code', () => {
        const wrapper = mountViewer({
            skill: makeSkill({
                warnings: [{ code: 'BODY_SOFT_BYTE_LIMIT', severity: 'warning', message: 'Body is long.' }],
            }),
        })
        expect(wrapper.get('[data-test="viewer-warnings"]').text()).toContain('BODY_SOFT_BYTE_LIMIT')
    })

    it('emits the skill name for edit and close', async () => {
        const wrapper = mountViewer({ skill: makeSkill() })
        await wrapper.get('[data-test="viewer-edit"]').trigger('click')
        await wrapper.get('[data-test="viewer-close"]').trigger('click')
        expect(wrapper.emitted('edit')?.[0]).toEqual(['invoice-drafting'])
        expect(wrapper.emitted('close')).toHaveLength(1)
    })

    it('emits duplicate for a shipped skill', async () => {
        const wrapper = mountViewer({ shipped: makeShipped(), contentsUnavailable: true })
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
