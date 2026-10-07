/**
 * `PrincipalScopeBar` — the panel's one piece of global state, made visible.
 *
 * Three things are load-bearing. The dropdown carries a skill count per entry,
 * because a count is what makes a scope something you *choose* rather than a
 * filter you apply — and the contract has no count endpoint, so each count is its
 * own `GET /custom-skills?principal_id=N`, read when the menu opens. A scope change
 * *navigates* rather than writing the store, because the path is the only writer of
 * the acting principal. And it lands on home: `unique(principal_id, name)` makes an
 * identically-named skill on another principal a real collision, so re-pointing a
 * desk mid-edit is the worst outcome the routing enables.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import PrincipalScopeBar from '../../src/components/PrincipalScopeBar.vue'
import * as api from '../../src/api/customSkills'
import { useSkillsStore } from '../../src/stores/skills'
import { usePrincipalsStore } from '../../src/stores/principals'
import { makePrincipal, makeSkill } from '../fixtures'

vi.mock('../../src/api/customSkills')

const mockedApi = vi.mocked(api)

let pinia: Pinia
let router: Router

function mountBar() {
    return mount(PrincipalScopeBar, { global: { plugins: [pinia, router] } })
}

beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.clearAllMocks()
    mockedApi.listSkills.mockResolvedValue([])

    router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', name: 'home', component: { template: '<div />' } },
            { path: '/p/:principalId', name: 'home-scoped', component: { template: '<div />' } },
            { path: '/p/:principalId/new', name: 'create', component: { template: '<div />' } },
            { path: '/p/:principalId/skill/:name', name: 'desk', component: { template: '<div />' } },
            { path: '/p/:principalId/library', name: 'catalogue', component: { template: '<div />' } },
            { path: '/p/:principalId/library/:name', name: 'viewer', component: { template: '<div />' } },
        ],
    })

    const principals = usePrincipalsStore()
    principals.principals = [
        makePrincipal(),
        makePrincipal({ id: 8, type: 'group', name: 'Studio', user_id: null, group_id: 2 }),
    ]
    principals.selectedPrincipalId = 7
})

describe('PrincipalScopeBar → the scope control', () => {
    it('names the selected principal and marks the caller’s own as "you"', () => {
        const wrapper = mountBar()
        const toggle = wrapper.get('[data-test="scope-toggle"]')
        expect(toggle.text()).toContain('Maya Fischer')
        expect(toggle.text()).toContain('you')
    })

    it('lists every principal the caller can act as when opened', async () => {
        const wrapper = mountBar()
        expect(wrapper.find('[data-test="scope-menu"]').exists()).toBe(false)
        await wrapper.get('[data-test="scope-toggle"]').trigger('click')
        // A `menu` of buttons, not a listbox of fake options: the entries were
        // always buttons with click handlers, and claiming `option` made a screen
        // reader announce something the keyboard behaviour did not match.
        const menu = wrapper.get('[data-test="scope-menu"]')
        expect(menu.attributes('role')).toBe('menu')
        expect(menu.findAll('button[data-test^="scope-option-"]')).toHaveLength(2)
        expect(wrapper.find('[role="option"]').exists()).toBe(false)
    })

    it('reads a count per entry, in the principal’s own scope, on open', async () => {
        mockedApi.listSkills.mockImplementation(async (id: number | null) =>
            id === 7 ? [makeSkill(), makeSkill({ name: 'b' })] : [makeSkill({ name: `only-${id}` })],
        )
        const wrapper = mountBar()
        await wrapper.get('[data-test="scope-toggle"]').trigger('click')
        await flushPromises()
        expect(wrapper.get('[data-test="scope-count-7"]').text()).toBe('2 skills')
        expect(wrapper.get('[data-test="scope-count-8"]').text()).toBe('1 skills')
        expect(mockedApi.listSkills).toHaveBeenCalledWith(8)
    })

    it('shows no count for a principal it cannot read rather than a wrong one', async () => {
        mockedApi.listSkills.mockRejectedValue(new Error('403'))
        const wrapper = mountBar()
        await wrapper.get('[data-test="scope-toggle"]').trigger('click')
        await flushPromises()
        expect(wrapper.find('[data-test="scope-count-8"]').exists()).toBe(false)
    })

    it('reads a count once per principal, not once per open', async () => {
        const store = useSkillsStore()
        mockedApi.listSkills.mockResolvedValue([])
        const wrapper = mountBar()
        await wrapper.get('[data-test="scope-toggle"]').trigger('click')
        await flushPromises()
        await wrapper.get('[data-test="scope-toggle"]').trigger('click')
        await wrapper.get('[data-test="scope-toggle"]').trigger('click')
        await flushPromises()
        expect(mockedApi.listSkills).toHaveBeenCalledTimes(2)
        expect(Object.keys(store.principalSkillCounts).sort()).toEqual(['7', '8'])
    })

    it('labels a group entry "Group" — the principals API carries no membership role', async () => {
        const wrapper = mountBar()
        await wrapper.get('[data-test="scope-toggle"]').trigger('click')
        await flushPromises()
        const entries = wrapper.findAll('button[data-test^="scope-option-"]')
        expect(entries[0]?.text()).toContain('Personal')
        expect(entries[1]?.text()).toContain('Group')
        // Asserting "admin" or "member" here would be inventing a fact: the host
        // does not send a role, so the read/write split is stated once for all.
        expect(wrapper.get('[data-test="scope-menu"]').text()).toContain('owner or an admin')
    })

    it('navigates to the new scope\'s home, carrying the principal in the path', async () => {
        await router.push('/p/7/skill/invoice-drafting')
        await router.isReady()
        const wrapper = mountBar()
        await wrapper.get('[data-test="scope-toggle"]').trigger('click')
        await flushPromises()
        await wrapper.get('[data-test="scope-option-8"]').trigger('click')
        await flushPromises()

        // Home, not the desk it came from: `unique(principal_id, name)` makes an
        // identically-named skill on another principal a real collision, so
        // re-pointing a desk mid-edit is the worst outcome the routing enables.
        expect(router.currentRoute.value.path).toBe('/p/8')
    })

    it('does not write the store itself — the URL is the only writer', async () => {
        // Two writers leave the path and the store disagreeing, which is the state
        // that made the panel read the wrong principal in the first place.
        const wrapper = mountBar()
        await wrapper.get('[data-test="scope-toggle"]').trigger('click')
        await flushPromises()
        await wrapper.get('[data-test="scope-option-8"]').trigger('click')
        await flushPromises()

        expect(usePrincipalsStore().selectedPrincipalId).toBe(7)
        expect(router.currentRoute.value.path).toBe('/p/8')
    })

    it('lands home even when re-picking the principal already selected', async () => {
        await router.push('/p/7/skill/invoice-drafting')
        await router.isReady()
        const wrapper = mountBar()
        await wrapper.get('[data-test="scope-toggle"]').trigger('click')
        await flushPromises()
        await wrapper.get('[data-test="scope-option-7"]').trigger('click')
        await flushPromises()
        expect(router.currentRoute.value.path).toBe('/p/7')
    })

    it('does not refetch the skills the store already holds for a principal', async () => {
        const store = useSkillsStore()
        store.principalSkillCounts = { 7: 3, 8: 7 }
        const wrapper = mountBar()
        await wrapper.get('[data-test="scope-toggle"]').trigger('click')
        await flushPromises()
        expect(mockedApi.listSkills).not.toHaveBeenCalled()
    })
})

describe('PrincipalScopeBar → navigation', () => {
    it('marks Skills as the current section everywhere except the catalogue', async () => {
        const wrapper = mountBar()
        expect(wrapper.get('[data-test="section-skills"]').attributes('aria-current')).toBe('page')
        expect(wrapper.get('[data-test="section-catalogue"]').attributes('aria-current')).toBeUndefined()

        await router.push('/p/7/library/code-review')
        await router.isReady()
        await flushPromises()
        expect(wrapper.get('[data-test="section-catalogue"]').attributes('aria-current')).toBe('page')
        expect(wrapper.get('[data-test="section-skills"]').attributes('aria-current')).toBeUndefined()
    })

    it('marks the catalogue section from the path shape, not the route name', async () => {
        // Home has two names (scoped and unscoped), and a `/library` prefix check
        // stopped matching the moment the principal moved into the path — which
        // would have left both section tabs lit at once.
        await router.push('/library')
        await router.isReady()
        const wrapper = mountBar()
        expect(wrapper.get('[data-test="section-catalogue"]').attributes('aria-current')).toBe('page')
    })

    it('treats the desk and the create form as the Skills section', async () => {
        await router.push('/p/7/skill/invoice-drafting')
        await router.isReady()
        const wrapper = mountBar()
        expect(wrapper.get('[data-test="section-skills"]').attributes('aria-current')).toBe('page')
    })

    it('sends New skill to the create route, carrying the acting principal', async () => {
        // The create *writes* to the principal in its path, so a link that dropped
        // it could write a group's skill onto the operator's own principal.
        const wrapper = mountBar()
        await wrapper.get('[data-test="new-skill"]').trigger('click')
        await flushPromises()
        expect(router.currentRoute.value.path).toBe('/p/7/new')
    })

    it('carries the acting principal in every section link', async () => {
        const wrapper = mountBar()
        expect(wrapper.get('[data-test="section-skills"]').attributes('href')).toBe('/p/7')
        expect(wrapper.get('[data-test="section-catalogue"]').attributes('href')).toBe('/p/7/library')
        expect(wrapper.get('[data-test="new-skill"]').attributes('href')).toBe('/p/7/new')
    })

    it('carries no search box — the host palette owns search', () => {
        // A second search box here would only ever see the *selected* principal's
        // skills, so it would quietly mean "search what is in memory".
        const wrapper = mountBar()
        expect(wrapper.find('input[type="search"]').exists()).toBe(false)
        expect(wrapper.find('input[type="text"]').exists()).toBe(false)
    })
})
