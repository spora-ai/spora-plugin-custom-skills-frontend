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
import { PANEL_ROUTES } from '../../src/lib/routes'
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

    // The real route map, so a spec that resolves a route resolves one the app
    // actually installs. `home` and `create` are the real pages; the rest render an
    // empty div, since this file is about the layout's bootstrap, not each page.
    const blank = { render: () => h('div') }
    // Home and the create form must be real — *including their scoped twins*, since
    // the layout canonicalises `/` into `/p/{id}` and every assertion here runs
    // against the scoped route. Keyed on the component rather than the route name so
    // a future third spelling of the same page does not silently render a stub.
    const realPages = new Set<unknown>([HomePage, CreateSkillPage])
    router = createRouter({
        history: createMemoryHistory(),
        routes: PANEL_ROUTES.map(({ path, name, component }) => ({
            path,
            name,
            // The rest render an empty div — this file is about the layout's
            // bootstrap, not each page.
            component: realPages.has(component) ? component : blank,
        })),
    })
    app.use(router)

    // The line under test: no `await router.isReady()`, matching main.ts.
    app.mount(target)

    return { app, target }
}

beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    // The principals envelope has to be answered, not just seeded on the store: the
    // layout now reconciles the acting principal against `GET /principals/me`, and a
    // list that comes back empty makes every principal-less path stay unscoped.
    setApi({
        get: vi.fn().mockImplementation(async (path: string) => {
            if (path === '/principals/me') return { principals: [makePrincipal()] }
            return { agents: [] }
        }),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
    } as never)
    mockedApi.listSkills.mockResolvedValue([])
    mockedApi.getSkillAllowlist.mockResolvedValue([])
    mockedPreshipped.listPreShippedSkills.mockResolvedValue([])
})

describe('App bootstrap (main.ts parity)', () => {
    it('canonicalises the bare root into the scoped home', async () => {
        const { target } = mountLikeMain()
        await flushPromises()
        await router.isReady()

        // `/apps/custom-skills` — what the apps dropdown links to — means "my own
        // skills". Once the principal list answers, the path is rewritten to say so
        // outright, so the URL survives a reload and a paste.
        expect(router.currentRoute.value.path).toBe('/p/7')
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

        expect(router.currentRoute.value.path).toBe('/p/7/new')
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

    it('sends no principal filter when the principal list could not be read', async () => {
        // With no principal to name, `null` is the contract's "the caller's own
        // user-principal". A stale id would be an IDOR, and the URL cannot be
        // canonicalised to a principal nobody resolved.
        setApi({
            get: vi.fn().mockRejectedValue(new Error('boom')),
            post: vi.fn(),
            put: vi.fn(),
            patch: vi.fn(),
            delete: vi.fn(),
        } as never)

        mountLikeMain()
        await flushPromises()
        await router.isReady()

        expect(mockedApi.listSkills).toHaveBeenCalledWith(null)
        expect(router.currentRoute.value.path).toBe('/')
    })

    it('renders no error banner on a clean load', async () => {
        const { target } = mountLikeMain()
        await flushPromises()
        await router.isReady()
        expect(target.querySelector('[role="alert"]')).toBeNull()
    })

    it('reloads the list and the agents when the URL names a different principal', async () => {
        // The scope bar navigates rather than writing the store, so the principal
        // arrives here as a *path*. The reload is what makes the new principal's
        // skills appear, and it must not re-read the shipped catalogue, which is
        // global and already loaded.
        setApi({
            get: vi.fn().mockImplementation(async (path: string) => {
                if (path === '/principals/me') {
                    return {
                        principals: [
                            makePrincipal(),
                            makePrincipal({ id: 8, type: 'group', name: 'Studio', user_id: null, group_id: 2 }),
                        ],
                    }
                }
                return { agents: [] }
            }),
            post: vi.fn(),
            put: vi.fn(),
            patch: vi.fn(),
            delete: vi.fn(),
        } as never)

        const { target } = mountLikeMain()
        await flushPromises()
        await router.isReady()
        expect(router.currentRoute.value.path).toBe('/p/7')

        mockedApi.listSkills.mockClear()
        mockedPreshipped.listPreShippedSkills.mockClear()

        await router.push('/p/8')
        await flushPromises()

        expect(usePrincipalsStore().selectedPrincipalId).toBe(8)
        expect(mockedApi.listSkills).toHaveBeenCalledWith(8)
        expect(mockedPreshipped.listPreShippedSkills).not.toHaveBeenCalled()
        expect(target.querySelector('[data-test="home-principal"]')?.textContent).toBe('Studio')
    })

    it('falls back and says so when the URL names a principal the caller cannot act as', async () => {
        // A shared link to a group you have since left is a real case: the path is a
        // URL, and URLs outlive membership. The alternative is rendering it as "No
        // skill named … on this principal", which blames the skill for a scope
        // problem.
        const { target } = mountLikeMain()
        await flushPromises()
        await router.isReady()

        await router.push('/p/4242/skill/test')
        await flushPromises()

        expect(usePrincipalsStore().selectedPrincipalId).toBe(7)
        expect(router.currentRoute.value.path).toBe('/p/7/skill/test')
        expect(target.querySelector('[role="alert"]')?.textContent).toContain('not one of yours')
    })

    it('clears a stale notice on a principal change', async () => {
        // "Deleted x." from the previous principal is not news about this one.
        const { useSkillsStore } = await import('../../src/stores/skills')
        setApi({
            get: vi.fn().mockImplementation(async (path: string) => {
                if (path === '/principals/me') {
                    return {
                        principals: [
                            makePrincipal(),
                            makePrincipal({ id: 8, type: 'group', name: 'Studio', user_id: null, group_id: 2 }),
                        ],
                    }
                }
                return { agents: [] }
            }),
            post: vi.fn(),
            put: vi.fn(),
            patch: vi.fn(),
            delete: vi.fn(),
        } as never)

        const { target } = mountLikeMain()
        await flushPromises()
        await router.isReady()
        useSkillsStore().notice = 'Deleted invoice-drafting.'
        await flushPromises()
        expect(target.textContent).toContain('Deleted invoice-drafting.')

        await router.push('/p/8')
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
