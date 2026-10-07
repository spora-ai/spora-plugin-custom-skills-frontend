/**
 * Reproduction against the app's REAL bootstrap: `main.ts → mount()` awaits `router.isReady()` before
 * `app.mount(target)`, so a layout reconciling before that navigation settles would link to a route
 * the router has not chosen yet.
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
import type { CustomSkillResource } from '../../src/types'
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

    // The real route map, so a spec resolves a route the app installs. Home and the create form are
    // real *including their scoped twins*, since the layout scopes `/`.
    const blank = { render: () => h('div') }
    const realPages = new Set<unknown>([HomePage, CreateSkillPage])
    router = createRouter({
        history: createMemoryHistory(),
        routes: PANEL_ROUTES.map(({ path, name, component }) => ({
            path,
            name,
            // The rest render an empty div: this file is about the layout's bootstrap.
            component: realPages.has(component) ? component : blank,
        })),
    })
    app.use(router)

    // No `await router.isReady()` here: this exercises the layout before the first navigation
    // has settled.
    app.mount(target)

    return { app, target }
}

beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    // Answered, not just seeded: the layout reconciles against `GET /principals/me`.
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

        // What the apps dropdown links to means "my own skills", rewritten once the principal answers.
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

        // One read each: a page that also loaded would double every request.
        expect(mockedApi.listSkills).toHaveBeenCalledTimes(1)
        expect(mockedPreshipped.listPreShippedSkills).toHaveBeenCalledTimes(1)
    })

    it('sends no principal filter when the principal list could not be read', async () => {
        // With no principal to name, `null` is the contract's "the caller's own
        // user-principal" — a stale id would be an IDOR.
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
        // The scope bar navigates rather than writing the store, so the principal arrives as a path.
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

    it('reloads when the scope changes while the first load is still open', async () => {
        // A host navigation can select another principal before the mount's own reads answer. A boolean
        // "first load finished" flag swallowed that, leaving the wrong principal's heading above.
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

        // Held open so the push below lands inside the window the old flag lost; without
        // this the mount's awaits resolve first and the test passes against the bug.
        let releaseList: ((skills: CustomSkillResource[]) => void) | null = null
        mockedApi.listSkills.mockImplementation(() => new Promise((resolve) => {
            releaseList = resolve
        }))

        const { target } = mountLikeMain()
        await router.isReady()

        await router.push('/p/8')
        expect(usePrincipalsStore().selectedPrincipalId).toBe(8)

        releaseList!([])
        await flushPromises()

        expect(mockedApi.listSkills).toHaveBeenCalledWith(8)
        expect(target.querySelector('[data-test="home-principal"]')?.textContent).toBe('Studio')
    })

    it('falls back and says so when the URL names a principal the caller cannot act as', async () => {
        // URLs outlive membership, and the alternative blames the skill for a scope problem.
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
