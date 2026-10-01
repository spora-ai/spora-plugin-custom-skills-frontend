/**
 * Reproduction against the app's REAL bootstrap. Mounting `SkillsPage` directly
 * passes, but that is not how the panel boots: `main.ts → mount()` calls
 * `app.mount(target)` **without awaiting `router.isReady()`**, and Vue Router
 * starts the initial navigation as a promise inside `install()`, so the first
 * render can happen while `currentRoute` is still `START_LOCATION`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createApp, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import App from '../../src/App.vue'
import { HOST_CONTEXT_KEY, type PluginHostContext } from '../../src/shims'
import { setApi } from '../../src/api/client'
import * as api from '../../src/api/customSkills'
import * as preshippedApi from '../../src/api/preshippedSkills'
import { usePrincipalsStore } from '../../src/stores/principals'

vi.mock('../../src/api/customSkills')
vi.mock('../../src/api/preshippedSkills')

const mockedApi = vi.mocked(api)
const mockedPreshipped = vi.mocked(preshippedApi)

let router: Router

function mountLikeMain() {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const hostContext: PluginHostContext = {
        api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
        pinia: null,
        theme: 'light',
        route: null,
        router: null,
    }

    const app = createApp(App as never, { hostContext })
    app.provide(HOST_CONTEXT_KEY, hostContext)
    app.use(createPinia())

    router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', name: 'skills', component: { render: () => h('div') } },
            { path: '/:name', name: 'skill', component: { render: () => h('div') } },
        ],
    })
    app.use(router)

    // The line under test: no `await router.isReady()`, matching main.ts.
    app.mount(target)

    return { app, target }
}

beforeEach(async () => {
    setActivePinia(createPinia())
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

describe('App bootstrap (main.ts parity)', () => {
    it('resolves the initial route to the skills list', async () => {
        const { target } = mountLikeMain()
        await flushPromises()
        await router.isReady()

        expect(router.currentRoute.value.name).toBe('skills')
        expect(target.querySelector('[data-test="new-skill"]')).not.toBeNull()
    })

    it('navigates to create=1 and reveals the editor on click', async () => {
        const { target } = mountLikeMain()
        await flushPromises()
        await router.isReady()

        const btn = target.querySelector<HTMLButtonElement>('[data-test="new-skill"]')
        expect(btn).not.toBeNull()

        btn!.click()
        await flushPromises()

        expect(router.currentRoute.value.query.create).toBe('1')
        expect(target.querySelector('[data-test="editor-pane"]')).not.toBeNull()
    })

    it('places the editor ABOVE the skill lists, not below them', async () => {
        // The reported bug: "New skill" did nothing, because the editor used to be
        // the last child of <main> — thousands of pixels below the fold. This is a
        // structural guard: the failure mode is purely positional, so no assertion
        // about the click would catch a regression back to the old order.
        const { target } = mountLikeMain()
        await flushPromises()
        await router.isReady()

        const button = target.querySelector<HTMLButtonElement>('[data-test="new-skill"]')
        button!.click()
        await flushPromises()

        const main = target.querySelector('main')
        const editor = target.querySelector('[data-test="editor-pane"]')
        const panes = target.querySelector('.grid')

        expect(main && editor && panes).toBeTruthy()
        expect(
            editor!.compareDocumentPosition(panes!) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy()
    })
})
