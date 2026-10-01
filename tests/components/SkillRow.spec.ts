/**
 * `SkillRow` — one row of a principal's skill list.
 *
 * The row's contract with the operator is that everything shown at rest is true
 * without another request. Warnings, provenance, the timestamp and the file count
 * all come out of `CustomSkillResource`; the per-row allowlist read happens only
 * when the menu is opened, which is why there is no "unused" pill.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import SkillRow from '../../src/components/SkillRow.vue'
import { makeAllowlistEntry, makeSkill } from '../fixtures'

const AGENTS = [{ id: 5, name: 'Invoicer' }, { id: 6, name: 'Researcher' }]

const router = createRouter({
    history: createMemoryHistory(),
    routes: [
        { path: '/', name: 'home', component: { template: '<div />' } },
        { path: '/skills/:name', name: 'desk', component: { template: '<div />' } },
    ],
})

function mountRow(props: Record<string, unknown> = {}) {
    return mount(SkillRow, {
        props: { skill: makeSkill(), allowlist: [], agents: AGENTS, ...props },
        global: { plugins: [createPinia(), router] },
    })
}

describe('SkillRow → at rest', () => {
    it('links the name at the desk, not at a query-string viewer', () => {
        const wrapper = mountRow()
        expect(wrapper.get('[data-test="skill-name"]').attributes('href')).toBe('/skills/invoice-drafting')
    })

    it('shows the description and the file count', () => {
        const wrapper = mountRow()
        expect(wrapper.get('[data-test="skill-description"]').text()).toContain('purchase order')
        // SKILL.md counts: the contract's manifest always includes it.
        expect(wrapper.get('[data-test="skill-files"]').text()).toContain('2 files')
    })

    it('says a missing description is a problem, rather than rendering nothing', () => {
        const wrapper = mountRow({ skill: makeSkill({ description: '' }) })
        expect(wrapper.get('[data-test="skill-description"]').text()).toContain('agents match skills on it')
    })

    it('pills the warnings the stored skill already carries', () => {
        const wrapper = mountRow({ skill: makeSkill({ warning_count: 2 }) })
        expect(wrapper.get('[data-test="row-warning-pill"]').text()).toContain('2 warnings')
    })

    it('shows no warning pill on a clean skill', () => {
        expect(mountRow().find('[data-test="row-warning-pill"]').exists()).toBe(false)
    })

    it('marks an agent-authored skill, since that is how you find out an agent rewrote it', () => {
        const wrapper = mountRow({ skill: makeSkill({ provenance: 'agent' }) })
        expect(wrapper.get('[data-test="row-agent-pill"]').text()).toBe('last edited by agent')
    })

    it('stamps the row with when it last changed', () => {
        const wrapper = mountRow()
        expect(wrapper.get('[data-test="skill-updated"]').text()).toMatch(/^updated /)
    })
})

describe('SkillRow → the menu', () => {
    it('is closed until asked, and asks for the allowlist when opened', async () => {
        const wrapper = mountRow()
        expect(wrapper.find('[data-test="row-menu"]').exists()).toBe(false)
        await wrapper.get('[data-test="row-actions"]').trigger('click')
        expect(wrapper.find('[data-test="row-menu"]').exists()).toBe(true)
        expect(wrapper.emitted('loadAllowlist')?.[0]).toEqual(['invoice-drafting'])
    })

    it('does not re-read an allowlist it already has', async () => {
        const wrapper = mountRow({ allowlist: [makeAllowlistEntry()], allowlistLoaded: true })
        await wrapper.get('[data-test="row-actions"]').trigger('click')
        expect(wrapper.emitted('loadAllowlist')).toBeUndefined()
    })

    it('states the agent-side failure verbatim when nothing allowlists the skill', async () => {
        const wrapper = mountRow()
        await wrapper.get('[data-test="row-actions"]').trigger('click')
        expect(wrapper.get('[data-test="allowlist-empty"]').text()).toBe(
            'Not enabled for any agent yet — add it to an agent\'s Skill tool settings before the agent can use it.',
        )
    })

    it('names the agents that resolve it, with the scope each entry means', async () => {
        const wrapper = mountRow({
            allowlist: [
                makeAllowlistEntry({ id: 5, name: 'Invoicer', scope: 'agent' }),
                makeAllowlistEntry({ id: 6, name: 'Researcher', scope: 'principal' }),
            ],
            allowlistLoaded: true,
        })
        await wrapper.get('[data-test="row-actions"]').trigger('click')
        const items = wrapper.findAll('[data-test="allowlist-list"] li')
        expect(items[0]?.text()).toContain('Invoicer')
        expect(items[0]?.text()).toContain('agent override')
        expect(items[1]?.text()).toContain('inherited default')
    })

    it('offers only agents that do not already resolve the skill', async () => {
        const wrapper = mountRow({
            allowlist: [makeAllowlistEntry({ id: 5, name: 'Invoicer' })],
            allowlistLoaded: true,
        })
        await wrapper.get('[data-test="row-actions"]').trigger('click')
        const options = wrapper.findAll('[data-test="agent-select"] option').map((o) => o.text())
        expect(options).toContain('Researcher')
        expect(options).not.toContain('Invoicer')
    })

    it('emits the chosen agent and closes, and refuses to emit with nothing chosen', async () => {
        const wrapper = mountRow()
        await wrapper.get('[data-test="row-actions"]').trigger('click')
        await wrapper.get('[data-test="enable-confirm"]').trigger('click')
        expect(wrapper.emitted('enable')).toBeUndefined()

        await wrapper.get('[data-test="agent-select"]').setValue('6')
        await wrapper.get('[data-test="enable-confirm"]').trigger('click')
        expect(wrapper.emitted('enable')?.[0]).toEqual(['invoice-drafting', 6])
    })

    it('emits a remove per allowlisted agent', async () => {
        const wrapper = mountRow({
            allowlist: [makeAllowlistEntry({ id: 5, name: 'Invoicer' })],
            allowlistLoaded: true,
        })
        await wrapper.get('[data-test="row-actions"]').trigger('click')
        await wrapper.get('[data-test="disable-on-5"]').trigger('click')
        expect(wrapper.emitted('disable')?.[0]).toEqual(['invoice-drafting', 5])
    })

    it('offers restore only when the server holds a previous snapshot', async () => {
        const withPrevious = mountRow()
        await withPrevious.get('[data-test="row-actions"]').trigger('click')
        expect(withPrevious.find('[data-test="row-restore"]').exists()).toBe(true)

        const withoutPrevious = mountRow({ skill: makeSkill({ has_previous: false }) })
        await withoutPrevious.get('[data-test="row-actions"]').trigger('click')
        expect(withoutPrevious.find('[data-test="row-restore"]').exists()).toBe(false)
    })

    it('emits the name for restore and for delete', async () => {
        const wrapper = mountRow()
        await wrapper.get('[data-test="row-actions"]').trigger('click')
        await wrapper.get('[data-test="row-restore"]').trigger('click')
        expect(wrapper.emitted('restore')?.[0]).toEqual(['invoice-drafting'])

        await wrapper.get('[data-test="row-actions"]').trigger('click')
        await wrapper.get('[data-test="row-delete"]').trigger('click')
        expect(wrapper.emitted('delete')?.[0]).toEqual(['invoice-drafting'])
    })

    it('closes on a click elsewhere', async () => {
        const wrapper = mountRow()
        await wrapper.get('[data-test="row-actions"]').trigger('click')
        await wrapper.get('[data-test="row-menu-backdrop"]').trigger('click')
        expect(wrapper.find('[data-test="row-menu"]').exists()).toBe(false)
    })

    it('closes on a second click on the trigger', async () => {
        const wrapper = mountRow()
        await wrapper.get('[data-test="row-actions"]').trigger('click')
        await wrapper.get('[data-test="row-actions"]').trigger('click')
        expect(wrapper.find('[data-test="row-menu"]').exists()).toBe(false)
    })

    it('exposes no write control on the row itself — every mutation goes through an event', () => {
        const wrapper = mountRow()
        expect(wrapper.find('form').exists()).toBe(false)
        expect(wrapper.find('input').exists()).toBe(false)
    })
})
