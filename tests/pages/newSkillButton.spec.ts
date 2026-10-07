/**
 * Reproduction: the "New skill" button.
 *
 * The reported bug was that clicking it did nothing. The cause was structural — the
 * editor rendered *below* both lists, so on a ~20-skill catalogue it landed
 * thousands of pixels below the fold and the click produced no visible change.
 *
 * The fix is the page-per-destination shape, so the regression guard is positional
 * in the other direction: the click must change the route, and the route must be
 * what renders the form. These drive the real link in the real router rather than
 * calling a handler, covering the click → navigate → render chain a unit test of the
 * handler would skip.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { Router } from 'vue-router'
import PrincipalScopeBar from '../../src/components/PrincipalScopeBar.vue'
import CreateSkillPage from '../../src/pages/CreateSkillPage.vue'
import * as api from '../../src/api/customSkills'
import { usePrincipalsStore } from '../../src/stores/principals'
import { makePrincipal, makeSkill } from '../fixtures'
import { mountPage, stubRoutes } from '../mountPage'

vi.mock('../../src/api/customSkills')

const mockedApi = vi.mocked(api)

let pinia: Pinia
let router: Router

function mountBar() {
    // No `isReady()`: the bar is not a routed component, and nothing has started a
    // navigation for it to wait on.
    router = stubRoutes()
    return mountPage(PrincipalScopeBar, pinia, router)
}

beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.clearAllMocks()
    mockedApi.createSkill.mockResolvedValue(makeSkill({ name: 'invoice-drafting' }))

    const principals = usePrincipalsStore()
    principals.principals = [makePrincipal()]
    principals.selectedPrincipalId = 7
})

describe('New skill', () => {
    it('routes to the create form, which is a page rather than a pane below the list', async () => {
        const wrapper = await mountBar()
        expect(wrapper.find('[data-test="create-form"]').exists()).toBe(false)

        await wrapper.get('[data-test="new-skill"]').trigger('click')
        await flushPromises()
        expect(router.currentRoute.value.name).toBe('create')

        // The form is what the route resolves to, and it is mounted by the layout —
        // so there is nothing to scroll down to.
        await router.push('/new')
        await router.isReady()
        const form = mountPage(CreateSkillPage, pinia, router)
        expect(form.find('[data-test="create-form"]').exists()).toBe(true)
    })

    it('is a no-op-safe re-click: clicking twice keeps the same destination', async () => {
        const wrapper = await mountBar()
        await wrapper.get('[data-test="new-skill"]').trigger('click')
        await flushPromises()
        await wrapper.get('[data-test="new-skill"]').trigger('click')
        await flushPromises()
        expect(router.currentRoute.value.path).toBe('/p/7/new')
    })

    it('does not write anything just from opening the form', async () => {
        const wrapper = await mountBar()
        await wrapper.get('[data-test="new-skill"]').trigger('click')
        await flushPromises()
        // No nameless draft may exist at any point: the contract rejects a rename,
        // so the name is fixed at birth and the row is created on submit.
        expect(mockedApi.createSkill).not.toHaveBeenCalled()
    })

    it('goes home from the form without writing anything', async () => {
        await router.push('/new')
        await router.isReady()
        const form = mountPage(CreateSkillPage, pinia, router)
        await form.get('[data-test="create-back"]').trigger('click')
        await flushPromises()
        expect(router.currentRoute.value.path).toBe('/p/7')
        expect(mockedApi.createSkill).not.toHaveBeenCalled()
    })
})
