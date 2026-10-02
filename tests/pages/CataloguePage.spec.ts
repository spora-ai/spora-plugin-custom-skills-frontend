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
    it('POSTs a copy under a non-reserved name and opens its desk', async () => {
        useSkillsStore().preShipped = [makePreShipped({ name: 'code-review' })]
        const wrapper = await mountOn('/library')
        await flushPromises()

        await wrapper.get('[data-test="duplicate-skill"]').trigger('click')
        await flushPromises()

        expect(mockedPreshipped.getPreShippedSkill).toHaveBeenCalledWith('code-review')
        expect(mockedApi.createSkill).toHaveBeenCalledWith(7, expect.objectContaining({
            name: 'code-review-copy',
            body: '# Review\n',
        }))
        expect(router.currentRoute.value.path).toBe('/skills/code-review-copy')
    })

    it('warns that shipped sidecar contents are not readable through the host API', async () => {
        useSkillsStore().preShipped = [makePreShipped({ name: 'code-review' })]
        mockedPreshipped.getPreShippedSkill.mockResolvedValue(makePreShippedDetail({
            name: 'code-review',
            files: [
                { path: 'SKILL.md', bytes: 10 },
                { path: 'references/REFERENCE.md', bytes: 20 },
            ],
        }))
        const wrapper = await mountOn('/library')
        await flushPromises()
        await wrapper.get('[data-test="duplicate-skill"]').trigger('click')
        await flushPromises()
        expect(useSkillsStore().notice).toContain('re-add 1 sidecar file (references/REFERENCE.md)')
    })

    it('increments the fork name until it is free on this principal', async () => {
        useSkillsStore().skills = [makeSkill({ name: 'code-review-copy' })]
        useSkillsStore().preShipped = [makePreShipped({ name: 'code-review' })]
        mockedApi.createSkill.mockResolvedValue(makeSkill({ name: 'code-review-copy-2' }))
        const wrapper = await mountOn('/library')
        await flushPromises()
        await wrapper.get('[data-test="duplicate-skill"]').trigger('click')
        await flushPromises()
        expect(mockedApi.createSkill).toHaveBeenCalledWith(7, expect.objectContaining({
            name: 'code-review-copy-2',
        }))
    })

    it('stays on the catalogue when the copy is rejected', async () => {
        useSkillsStore().preShipped = [makePreShipped({ name: 'code-review' })]
        mockedApi.createSkill.mockRejectedValue(new Error('422'))
        const wrapper = await mountOn('/library')
        await flushPromises()
        await wrapper.get('[data-test="duplicate-skill"]').trigger('click')
        await flushPromises()
        expect(router.currentRoute.value.path).toBe('/library')
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

    it('duplicates from the viewer and lands on the new skill’s desk', async () => {
        useSkillsStore().preShipped = [makePreShipped({ name: 'code-review' })]
        const wrapper = await mountOn('/library/code-review')
        await flushPromises()
        await wrapper.get('[data-test="viewer-duplicate"]').trigger('click')
        await flushPromises()
        expect(mockedApi.createSkill).toHaveBeenCalledWith(7, expect.objectContaining({
            name: 'code-review-copy',
        }))
        expect(router.currentRoute.value.path).toBe('/skills/code-review-copy')
    })

    it('goes back to the catalogue', async () => {
        const wrapper = await mountOn('/library/code-review')
        await flushPromises()
        expect(wrapper.get('[data-test="viewer-back"]').attributes('href')).toBe('/library')
    })

    it('does not duplicate a skill the catalogue did not list', async () => {
        // The duplicate path allocates the fork name from the loaded list, so a
        // deep link with nothing seeded has nothing to copy *from* and must not
        // invent a name.
        const wrapper = await mountOn('/library/code-review')
        await flushPromises()
        await wrapper.get('[data-test="viewer-duplicate"]').trigger('click')
        await flushPromises()
        expect(mockedApi.createSkill).not.toHaveBeenCalled()
        expect(router.currentRoute.value.path).toBe('/library/code-review')
    })
})
