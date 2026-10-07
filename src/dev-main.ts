/**
 * Dev-only entry: the production tree rendered into `#app` with a mock host context, so the UI loads
 * without a backend. The mock API lives in `./dev-mock`. Against a real backend use the host dev
 * flow — PHP on :8080, this on :5190, host SPA on :5173 — which forwards `/api` and
 * `/plugins/custom-skills/*`.
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import App from './App.vue'
import { panelRoutes } from './lib/routes'
import { HOST_CONTEXT_KEY, type PluginHostContext } from './shims'
import { setApi } from './api/client'
import { createMockApi } from './dev-mock'
import { hostPathForLocalPath, localPathForHostPath } from './lib/hostRoute'

console.info('[spora/custom-skills] dev sandbox — using in-memory fixtures (no backend)')

const mockApi = createMockApi()
setApi(mockApi)

const APP_SLUG = 'custom-skills'
const INITIAL_HOST_PATH = `/apps/${APP_SLUG}`

/** A stand-in for the host router. `history.replaceState` is the point: in the sandbox the
 *  browser URL *is* the host URL, so navigating the panel has to move it. */
function createDevHostRouter(): NonNullable<PluginHostContext['router']> {
    type Guard = (
        to: { path: string; fullPath?: string; query?: Record<string, unknown> },
        from: unknown,
        failure?: unknown,
    ) => void
    const listeners = new Set<Guard>()
    const state = {
        push: (to: string) => {
            window.history.replaceState({}, '', to)
            // `currentRoute` moves too: the sync's "already there?" guard reads it, and leaving it
            // pinned would never exercise the echo case.
            state.currentRoute.value = { path: to.split('?')[0] ?? to }
            for (const listener of listeners) listener({ path: to }, undefined, undefined)
            return Promise.resolve(undefined)
        },
        currentRoute: { value: { path: INITIAL_HOST_PATH } as { path: string } },
        afterEach: (cb: Guard) => {
            listeners.add(cb)
            return () => {
                listeners.delete(cb)
            }
        },
    }
    return state
}

const hostContext: PluginHostContext = {
    api: mockApi,
    pinia: createPinia(),
    theme: 'light',
    route: { path: INITIAL_HOST_PATH, params: { appName: APP_SLUG }, query: {} },
    router: createDevHostRouter(),
}

const router = createRouter({
    history: createMemoryHistory(),
    routes: panelRoutes(),
})

/** The same two-way sync `main.ts` installs, so the sandbox can reproduce a pasted link. */
router.afterEach((to) => {
    const hostRouter = hostContext.router
    if (hostRouter === null) return
    const hostPath = hostPathForLocalPath(to.path, APP_SLUG)
    if (hostRouter.currentRoute.value.path === hostPath) return
    void hostRouter.push(hostPath)
})

hostContext.router?.afterEach?.((to) => {
    const localPath = localPathForHostPath(to.path, APP_SLUG)
    if (localPath === null || router.currentRoute.value.path === localPath) return
    void router.replace(localPath)
})

// The banner does not say "the address bar is the host URL", so a pasted path has to come back out
// of the panel or the sandbox hides the one thing this sync exists for.
const deepLink = localPathForHostPath(window.location.pathname, APP_SLUG)
if (deepLink !== null) {
    void router.replace(deepLink)
}

console.info(`[spora/custom-skills] dev router: ${APP_SLUG} — the address bar is the host URL`)

const target = document.getElementById('app')
if (target) {
    const app = createApp(App, { hostContext })
    app.use(createPinia())
    app.use(router)
    app.provide(HOST_CONTEXT_KEY, hostContext)
    app.config.globalProperties.$host = hostContext
    app.mount(target)
}
