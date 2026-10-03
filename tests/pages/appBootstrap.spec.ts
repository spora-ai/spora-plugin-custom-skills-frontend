/**
 * Reproduction against the app's REAL bootstrap. Mounting a page directly passes,
 * but that is not how the panel boots: `main.ts → mount()` calls `app.mount(target)`
 * **without awaiting `router.isReady()`**, and Vue Router starts the initial
 * navigation as a promise inside `install()`, so the first render can happen while
 * `currentRoute` is still `START_LOCATION`.
 *
 * The second case is the shape of the whole panel: with a route per destination, a
 * scope bar that renders before the first navigation resolves would put a "New
 * skill" link on a route the router has not chosen yet.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createApp, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import App from '../../src/App.vue'
import HomePage from '../../src/pages/HomePage.vue'
import CreateSkillPage from '../../src/pages/CreateSkillPage.vue'
import { HOST_CONTEXT_KEY, type PluginHostContext } from '../../src/shims'
import { setApi } from '../../src/api/client'
import * as api from '../../src/api/customSkills'
import * as preshippedApi from '../../src/api/preshippedSkills'
import { usePrincipalsStore } from '../../src/stores/principals'
import { makePrincipal } from '../fixtures'

vi.mock('../../src/api/customSkills')
vi.mock('../../src/api/preshippedSkills')
vi.mock('../../src/api/agents')
vi.mock('../../src/api/agentAllowlist')

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
            { path: '/', name: 'home', component: HomePage },
            { path: '/new', name: 'create', component: CreateSkillPage },
            { path: '/skills/:name', name: 'desk', component: { render: () => h('div') } },
            { path: '/library', name: 'catalogue', component: { render: () => h('div') } },
            { path: '/library/:name', name: 'library', component: { render: () => h('div') } },
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
    mockedApi.getSkillAllowlist.mockResolvedValue([])
    mockedPreshipped.listPreShippedSkills.mockResolvedValue([])

    const principals = usePrincipalsStore()
    principals.principals = [makePrincipal()]
    principals.selectedPrincipalId = 7
})

describe('App bootstrap (main.ts parity)', () => {
    it('resolves the initial route to home', async () => {
        const { target } = mountLikeMain()
        await flushPromises()
        await router.isReady()

        expect(router.currentRoute.value.name).toBe('home')
        expect(target.querySelector('[data-test="home-page"]')).not.toBeNull()
    })

    it('renders the scope bar and the New skill link on the first render', async () => {
        const { target } = mountLikeMain()
        await flushPromises()
        await router.isReady()

        expect(target.querySelector('[data-test="principal-scope"]')).not.toBeNull()
        expect(target.querySelector('[data-test="new-skill"]')).not.toBeNull()
    })

    it('navigates to the create form on click, and the form is what appears', async () => {
        const { target } = mountLikeMain()
        await flushPromises()
        await router.isReady()

        const link = target.querySelector<HTMLAnchorElement>('[data-test="new-skill"]')
        expect(link).not.toBeNull()

        link!.click()
        await flushPromises()
        await router.isReady()

        expect(router.currentRoute.value.path).toBe('/new')
        expect(target.querySelector('[data-test="create-page"]')).not.toBeNull()
        expect(target.querySelector('[data-test="create-form"]')).not.toBeNull()
    })

    it('reads the principal, its skills and the host catalogue once, from the layout', async () => {
        mountLikeMain()
        await flushPromises()
        await router.isReady()

        // One read each. The layout is the single place that loads, so a page that
        // also loaded would double every request on navigation.
        expect(mockedApi.listSkills).toHaveBeenCalledTimes(1)
        expect(mockedPreshipped.listPreShippedSkills).toHaveBeenCalledTimes(1)
    })

    it('sends no principal filter when none is selected, rather than a wrong one', async () => {
        // `mountLikeMain` installs its own Pinia, so this store starts empty and
        // the host client returns no principals envelope. `null` is the contract's
        // "the caller's own user-principal"; a stale id would be an IDOR.
        mountLikeMain()
        await flushPromises()
        await router.isReady()
        expect(mockedApi.listSkills).toHaveBeenCalledWith(null)
    })

    it('renders no error banner on a clean load', async () => {
        const { target } = mountLikeMain()
        await flushPromises()
        await router.isReady()
        expect(target.querySelector('[role="alert"]')).toBeNull()
    })

    it('reloads the list and the agents when the principal changes', async () => {
        // The scope bar navigates to home on a change; the reload is what makes the
        // new principal's skills appear, and it must not re-read the shipped
        // catalogue, which is global and already loaded.
        const { target } = mountLikeMain()
        await flushPromises()
        await router.isReady()
        mockedApi.listSkills.mockClear()
        mockedPreshipped.listPreShippedSkills.mockClear()

        const principals = usePrincipalsStore()
        principals.principals = [
            makePrincipal(),
            makePrincipal({ id: 8, type: 'group', name: 'Studio', user_id: null, group_id: 2 }),
        ]
        principals.selectPrincipal(8)
        await flushPromises()

        expect(mockedApi.listSkills).toHaveBeenCalledWith(8)
        expect(mockedPreshipped.listPreShippedSkills).not.toHaveBeenCalled()
        expect(target.querySelector('[data-test="home-principal"]')?.textContent).toBe('Studio')
    })

    it('clears a stale notice on a principal change', async () => {
        // "Deleted x." from the previous principal is not news about this one.
        const { useSkillsStore } = await import('../../src/stores/skills')
        const { target } = mountLikeMain()
        await flushPromises()
        await router.isReady()
        useSkillsStore().notice = 'Deleted invoice-drafting.'
        await flushPromises()
        expect(target.textContent).toContain('Deleted invoice-drafting.')

        const principals = usePrincipalsStore()
        principals.principals = [
            makePrincipal(),
            makePrincipal({ id: 8, type: 'group', name: 'Studio', user_id: null, group_id: 2 }),
        ]
        principals.selectPrincipal(8)
        await flushPromises()
        expect(target.textContent).not.toContain('Deleted invoice-drafting.')
    })

    it('surfaces a failed read as an error banner in the layout, not on a page', async () => {
        mockedApi.listSkills.mockRejectedValue(new Error('boom'))
        const { target } = mountLikeMain()
        await flushPromises()
        await router.isReady()
        const alert = target.querySelector('[role="alert"]')
        expect(alert?.textContent).toContain('Failed to load skills.')
    })
})
