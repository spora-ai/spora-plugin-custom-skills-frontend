/**
 * Dev-only entry: the same component tree as the production bundle, rendered into
 * `#app` with a mock host context so the UI loads without a backend. The mock API
 * lives in `./dev-mock` so it is testable without this bootstrap.
 *
 * For end-to-end testing against a real backend use the host dev flow — PHP on
 * :8080, this server on :5190, host SPA on :5173 — which forwards `/api` to PHP
 * and `/plugins/custom-skills/*` here.
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

// Banner so a developer doesn't waste time wondering why their backend isn't
// responding.
console.info('[spora/custom-skills] dev sandbox — using in-memory fixtures (no backend)')

const mockApi = createMockApi()
setApi(mockApi)

const APP_SLUG = 'custom-skills'
const INITIAL_HOST_PATH = `/apps/${APP_SLUG}`

/**
 * A stand-in for the host router, faithful enough to exercise the real sync.
 *
 * `history.replaceState` is the point: in the sandbox the browser URL *is* the host
 * URL, so navigating the panel has to move it or the dev experience claims a behaviour
 * the host does not have.
 */
function createDevHostRouter(): NonNullable<PluginHostContext['router']> {
    const listeners = new Set<(to: { path: string }) => void>()
    const state = {
        push: (to: string) => {
            const path = to.split('?')[0] ?? to
            window.history.replaceState({}, '', to)
            for (const listener of listeners) listener({ path })
            return Promise.resolve(undefined)
        },
        currentRoute: { value: { path: INITIAL_HOST_PATH } },
        afterEach: (cb: (to: { path: string }) => void) => {
            listeners.add(cb)
            return () => listeners.delete(cb)
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

// Without `app.use(router)` the `useRoute()` inject keys are missing and the pages
// warn.
const router = createRouter({
    history: createMemoryHistory(),
    routes: panelRoutes(),
})

// The same two-way sync `main.ts` installs, so the sandbox can reproduce a
// pasted deep link rather than only the happy path.
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

// The banner does not say "the address bar is the host URL" — so a pasted path has to
// come back out of the panel, or the sandbox hides the one thing this sync exists for.
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
