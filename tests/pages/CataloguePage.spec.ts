/**
 * `CataloguePage` — `/library`, and `SkillViewerPage` — `/library/:name`.
 *
 * The catalogue is global and read-only by contract ("Not endpoints (deliberately)"),
 * so the only way out of a row is *Duplicate*, which writes a copy onto the acting
 * principal under a non-reserved name. The viewer is a separate route rather than a
 * query on the desk, because a shipped skill is not the same kind of thing as a
 * principal-scoped one.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { Router } from 'vue-router'
import CataloguePage from '../../src/pages/CataloguePage.vue'
import SkillViewerPage from '../../src/pages/SkillViewerPage.vue'
import * as api from '../../src/api/customSkills'
import * as preshippedApi from '../../src/api/preshippedSkills'
import { useSkillsStore } from '../../src/stores/skills'
import { usePrincipalsStore } from '../../src/stores/principals'
import { makePrincipal, makePreShipped, makePreShippedDetail, makeSkill } from '../fixtures'
import { mountPage, stubRoutes } from '../mountPage'

vi.mock('../../src/api/customSkills')
vi.mock('../../src/api/preshippedSkills')

const mockedApi = vi.mocked(api)
const mockedPreshipped = vi.mocked(preshippedApi)

let pinia: Pinia
let router: Router

async function mountOn(path: string) {
    router = stubRoutes()
    await router.push(path)
    await router.isReady()
    return mountPage(path === '/library' ? CataloguePage : SkillViewerPage, pinia, router)
}

beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.clearAllMocks()
    mockedApi.createSkill.mockResolvedValue(makeSkill({ name: 'code-review-copy' }))
    mockedPreshipped.getPreShippedSkill.mockResolvedValue(makePreShippedDetail({ name: 'code-review' }))

    const principals = usePrincipalsStore()
    principals.principals = [makePrincipal()]
    principals.selectedPrincipalId = 7
    useSkillsStore().skills = []
})

describe('CataloguePage → the list', () => {
    it('shows a loading line while the host catalogue is in flight', async () => {
        useSkillsStore().preShippedLoading = true
        const wrapper = await mountOn('/library')
        await flushPromises()
        expect(wrapper.find('[data-test="catalogue-empty"]').exists()).toBe(false)
        expect(wrapper.text()).toContain('Loading the host catalogue')
    })

    it('groups by source, because that is the only thing that says who shipped it', async () => {
        useSkillsStore().preShipped = [
            makePreShipped({ name: 'code-review', source: 'core' }),
            makePreShipped({ name: 'release-notes', source: 'core' }),
            makePreShipped({ name: 'brand-voice', source: 'marketing' }),
        ]
        const wrapper = await mountOn('/library')
        await flushPromises()
        expect(wrapper.findAll('[data-test="source-group"]').map((g) => g.text()))
            .toEqual(['core · 2', 'marketing · 1'])
    })

    it('never lists a principal-scoped skill as a shipped one', async () => {
        // Driven through the real load, not a hand-set `preShipped`, because the
        // guarantee lives in the store: `/api/v1/skills` answers with the union
        // over every principal the caller can see, so the response carries this
        // plugin's own skills. The Catalogue claims to be what the host ships.
        mockedPreshipped.listPreShippedSkills.mockResolvedValueOnce([
            makePreShipped({ name: 'code-review', source: 'core' }),
            makePreShipped({ name: 'hello-world', source: 'custom-skills' }),
        ])
        const store = useSkillsStore()
        await store.loadPreShippedSkills()
        const wrapper = await mountOn('/library')
        await flushPromises()
        expect(wrapper.findAll('[data-test="preshipped-name"]').map((n) => n.text()))
            .toEqual(['code-review'])
        expect(wrapper.text()).not.toContain('hello-world')
    })

    it('names the host route, because this plugin must never re-serve it', async () => {
        useSkillsStore().preShipped = [makePreShipped()]
        const wrapper = await mountOn('/library')
        await flushPromises()
        expect(wrapper.text()).toContain('/api/v1/skills')
    })

    it('says the host ships none rather than showing an empty list', async () => {
        const wrapper = await mountOn('/library')
        await flushPromises()
        expect(wrapper.get('[data-test="catalogue-empty"]').text()).toContain('This host ships no skills')
    })

    it('offers only the name orders — a shipped summary carries no timestamp', async () => {
        useSkillsStore().preShipped = [
            makePreShipped({ name: 'zebra' }),
            makePreShipped({ name: 'alpha' }),
        ]
        const wrapper = await mountOn('/library')
        await flushPromises()
        const options = wrapper.get('#library-sort').findAll('option').map((o) => o.text())
        expect(options).toEqual(['Name (A–Z)', 'Name (Z–A)'])
        expect(wrapper.findAll('[data-test="preshipped-name"]').map((n) => n.text()))
            .toEqual(['alpha', 'zebra'])

        await wrapper.get('#library-sort').setValue('name-desc')
        expect(wrapper.findAll('[data-test="preshipped-name"]').map((n) => n.text()))
            .toEqual(['zebra', 'alpha'])
    })

    it('links a row at the viewer route, not at the desk', async () => {
        useSkillsStore().preShipped = [makePreShipped({ name: 'code-review' })]
        const wrapper = await mountOn('/library')
        await flushPromises()
        expect(wrapper.get('[data-test="preshipped-name"]').attributes('href')).toBe('/library/code-review')
        expect(wrapper.get('[data-test="view-shipped"]').attributes('href')).toBe('/library/code-review')
    })
})

describe('CataloguePage → duplicate', () => {
    it('sends Duplicate to the create form as a template, and writes nothing', async () => {
        useSkillsStore().preShipped = [makePreShipped({ name: 'code-review' })]
        const wrapper = await mountOn('/library')
        await flushPromises()

        await wrapper.get('[data-test="duplicate-skill"]').trigger('click')
        await flushPromises()

        // Nothing is written here. The name is final, and a copy written before the
        // operator has seen it is a row they then have to delete.
        expect(mockedApi.createSkill).not.toHaveBeenCalled()
        expect(router.currentRoute.value.path).toBe('/new')
        expect(router.currentRoute.value.query.template).toBe('code-review')
    })

    it('offers the template action whatever the shipped name is', async () => {
        useSkillsStore().preShipped = [makePreShipped({ name: 'invoice-drafting' })]
        const wrapper = await mountOn('/library')
        await flushPromises()

        await wrapper.get('[data-test="duplicate-skill"]').trigger('click')
        await flushPromises()
        expect(router.currentRoute.value.query.template).toBe('invoice-drafting')
    })

})

describe('SkillViewerPage → reading a shipped skill', () => {
    it('shows the read-only inspector and no edit control', async () => {
        const wrapper = await mountOn('/library/code-review')
        await flushPromises()
        expect(mockedPreshipped.getPreShippedSkill).toHaveBeenCalledWith('code-review')
        expect(wrapper.get('[data-test="viewer-title"]').text()).toBe('code-review')
        expect(wrapper.get('[data-test="viewer-readonly-badge"]').text()).toContain('read-only')
        expect(wrapper.find('[data-test="viewer-edit"]').exists()).toBe(false)
        expect(wrapper.find('[data-test="viewer-duplicate"]').exists()).toBe(true)
    })

    it('says the host has no such skill rather than rendering an empty inspector', async () => {
        mockedPreshipped.getPreShippedSkill.mockRejectedValue(new Error('404'))
        const wrapper = await mountOn('/library/nope')
        await flushPromises()
        expect(wrapper.get('[data-test="viewer-failed"]').text()).toContain('no skill named “nope”')
        expect(wrapper.find('[data-test="viewer-pane"]').exists()).toBe(false)
    })

    it('sends the viewer\u2019s Duplicate to the same create form, for the same reason', async () => {
        useSkillsStore().preShipped = [makePreShipped({ name: 'code-review' })]
        const wrapper = await mountOn('/library/code-review')
        await flushPromises()
        await wrapper.get('[data-test="viewer-duplicate"]').trigger('click')
        await flushPromises()

        // One word, one meaning. A Duplicate that wrote from one page and
        // navigated from another is the kind of thing that gets clicked twice.
        expect(mockedApi.createSkill).not.toHaveBeenCalled()
        expect(router.currentRoute.value.path).toBe('/new')
        expect(router.currentRoute.value.query.template).toBe('code-review')
    })

    it('goes back to the catalogue', async () => {
        const wrapper = await mountOn('/library/code-review')
        await flushPromises()
        expect(wrapper.get('[data-test="viewer-back"]').attributes('href')).toBe('/library')
    })

    it('duplicates from a deep link even when the catalogue list is empty', async () => {
        // The old path read the fork name off the loaded list, so a deep link with
        // nothing seeded had nothing to copy from. The name is now the route
        // parameter, so there is no list to be out of step with.
        const wrapper = await mountOn('/library/code-review')
        await flushPromises()
        await wrapper.get('[data-test="viewer-duplicate"]').trigger('click')
        await flushPromises()
        expect(router.currentRoute.value.query.template).toBe('code-review')
    })
})
