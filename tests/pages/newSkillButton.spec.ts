/**
 * Reproduction: the "New skill" button. It calls `startCreate()`, which pushes
 * `{ create: '1' }` and relies on `isCreating` to reveal the editor. Duplication
 * works because it pushes a *different* route after the write lands, so the two
 * paths never exercise the same navigation.
 *
 * These drive the real button in the real router rather than calling
 * `startCreate()`, covering the click → push → render chain a handler unit test
 * would skip.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import SkillsPage from '../../src/pages/SkillsPage.vue'
import { HOST_CONTEXT_KEY, type PluginHostContext } from '../../src/shims'
import { setApi } from '../../src/api/client'
import * as api from '../../src/api/customSkills'
import * as preshippedApi from '../../src/api/preshippedSkills'
import { usePrincipalsStore } from '../../src/stores/principals'

vi.mock('../../src/api/customSkills')
vi.mock('../../src/api/preshippedSkills')

const mockedApi = vi.mocked(api)
const mockedPreshipped = vi.mocked(preshippedApi)

let pinia: Pinia
let router: Router

function mountPage() {
    router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', name: 'skills', component: SkillsPage },
            { path: '/:name', name: 'skill', component: SkillsPage },
        ],
    })
    const hostContext: PluginHostContext = {
        api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
        pinia: null,
        theme: 'light',
        route: null,
        router: null,
    }
    return mount(SkillsPage, {
        global: {
            plugins: [pinia, router],
            provide: { [HOST_CONTEXT_KEY as symbol]: hostContext },
        },
    })
}

beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.clearAllMocks()
    setApi({
        get: vi.fn().mockResolvedValue({ agents: [] }),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
    } as never)
    mockedApi.listSkills.mockResolvedValue([])
    mockedApi.listSkillFiles.mockResolvedValue([])
    mockedApi.getSkillFile.mockResolvedValue({ path: 'x.md', content: 'x', bytes: 1 })
    mockedApi.getSkillAllowlist.mockResolvedValue([])
    mockedPreshipped.listPreShippedSkills.mockResolvedValue([])

    const principals = usePrincipalsStore()
    principals.principals = [{ id: 7, type: 'user', name: 'User #7', user_id: 3, group_id: null }]
    principals.selectedPrincipalId = 7
})

describe('New skill button', () => {
    it('opens a blank editor when clicked', async () => {
        const wrapper = mountPage()
        await flushPromises()

        expect(wrapper.find('[data-test="editor-pane"]').exists()).toBe(false)

        await wrapper.find('[data-test="new-skill"]').trigger('click')
        await flushPromises()

        expect(wrapper.find('[data-test="editor-pane"]').exists()).toBe(true)
        expect(router.currentRoute.value.query.create).toBe('1')
    })

    it('is a no-op-safe re-click: clicking twice keeps the editor open', async () => {
        const wrapper = mountPage()
        await flushPromises()

        await wrapper.find('[data-test="new-skill"]').trigger('click')
        await flushPromises()
        await wrapper.find('[data-test="new-skill"]').trigger('click')
        await flushPromises()

        expect(wrapper.find('[data-test="editor-pane"]').exists()).toBe(true)
    })

    it('does not fire a create request just from opening the editor', async () => {
        const wrapper = mountPage()
        await flushPromises()
        mockedApi.createSkill.mockClear()

        await wrapper.find('[data-test="new-skill"]').trigger('click')
        await flushPromises()

        expect(mockedApi.createSkill).not.toHaveBeenCalled()
    })
})
