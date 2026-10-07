import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, type LocationQueryRaw } from 'vue-router'
import App from './App.vue'
import { panelRoutes } from './lib/routes'
import { setApi } from './api/client'
import { appSlugFrom, localPathForHostRoute } from './lib/hostRoute'
import { HOST_CONTEXT_KEY, type PluginHostContext } from './shims'

/**
 * Plugin mount/unmount contract, installed on `window.SporaAppCustomSkills`; the host's
 * `apps/registry.ts` calls it. A *local* Pinia and a *local* router (`createMemoryHistory`, since the
 * host owns the address bar) keep plugin-only state out of host stores.
 *
 * **The host URL is the source of truth; the local router mirrors it.** `replace` in, `push` out: a
 * host navigation has *already* been pushed onto the browser's stack, so replacing the local route
 * avoids counting it twice, while a local navigation is a destination the operator chose and earns
 * a history entry. Without the local → host direction nothing is linkable or reloadable.
 */

interface MountContract {
    mount: (target: HTMLElement, hostContext: PluginHostContext) => Promise<void>
    unmount: (target: HTMLElement) => void
}

interface MountTarget extends HTMLElement {
    __sporaApp?: { unmount: () => void; app: import('vue').App }
}

/** Whether two query objects carry the same values, order-insensitively — the echo guard needs it,
 *  since a reorder-only navigation still means "already there". Never sort the keys: locale-
 *  dependent (typescript:S2871) and pointless for a set of pairs. */
function sameQuery(a: Record<string, unknown>, b?: Record<string, unknown>): boolean {
    if (b === undefined) return Object.keys(a).length === 0

    const keys = Object.keys(a)
    if (keys.length !== Object.keys(b).length) return false

    return keys.every((key) => a[key] === b[key])
}

const SporaApp: MountContract = {
    /**
     * Async on purpose, and the registry awaits a thenable return: the panel can be mounted onto a
     * URL that already names a principal and a skill, and `RouterView` renders nothing until that
     * navigation resolves. Mounting first would let the layout canonicalise the URL against an
     * unsettled route, replacing away the desk the URL asked for.
     */
    async mount(target: HTMLElement, hostContext: PluginHostContext): Promise<void> {
        // The host remounts this bundle repeatedly and a target can still hold a previous app; Vue's
        // `mount()` on a non-empty container reconciles against an unknown app and throws.
        (target as MountTarget).__sporaApp?.unmount()

        setApi(hostContext.api)

        const app = createApp(App, { hostContext })

        app.provide(HOST_CONTEXT_KEY, hostContext)

        app.use(createPinia())

        const router = createRouter({
            history: createMemoryHistory(),
            routes: panelRoutes(),
        })
        app.use(router)

        const appSlug = appSlugFrom(hostContext.route)

        // The host registers no child route under `/apps/:appName/:rest*` for our shapes, so this app
        // parses the path itself. Host navigation is listened for via `afterEach` rather than by
        // watching `hostContext.router.currentRoute`: plugin and host ship separate `vue` copies, so
        // the host's `shallowRef` sits behind a proxy that does not subscribe to its deps.
        const hostRouter = hostContext.router
        let unregisterHostRoute: (() => void) | undefined
        // Suppresses navigation *started* after teardown; it cannot retract a push already issued.
        let disposed = false

        // Read once at mount — what a palette hit, a reload or a pasted link looks like. `isReady()`
        // matters as much as the `replace`: `App.vue` canonicalises the acting principal on its *own*
        // mount, so a path still at `START_LOCATION` would replace away the desk the URL asked for.
        // The query travels too, or `/p/7/new?template=x` reloads blank.
        const hostRoute = hostRouter?.currentRoute?.value ?? null
        const initial = localPathForHostRoute(hostRoute, appSlug)
        if (initial !== null) {
            await router.replace({ path: initial, query: (hostRoute?.query ?? {}) as LocationQueryRaw })
        }
        await router.isReady()

        if (hostRouter !== null) {
            // Host → local, guarded on the current local path so a navigation that did not concern this
            // app — or one this app caused — is a no-op, not a redirect loop. `failure` is checked first:
            // vue-router fires `afterEach` for CANCELLED too, so a superseded one would write a path
            // that never happened.
            unregisterHostRoute = hostRouter.afterEach?.((to, _from, failure) => {
                if (disposed || failure) return
                const localPath = localPathForHostRoute(to, appSlug)
                if (localPath === null) return
                const current = router.currentRoute.value
                if (current.path === localPath && sameQuery(current.query, to.query)) return
                void router.replace({ path: localPath, query: to.query as LocationQueryRaw }).catch(() => {})
            })

            // Local → host: without this direction nothing the panel shows is linkable.
            router.afterEach((to, _from, failure) => {
                if (disposed || failure) return
                // `to.fullPath`, not `to.path`: Duplicate navigates with `?template=`.
                const hostPath = to.fullPath.replace(/^/, `/apps/${appSlug}`)
                const currentHostPath = hostRouter.currentRoute?.value?.path
                if (currentHostPath === undefined || currentHostPath === hostPath) return
                void hostRouter.push(hostPath).catch(() => {})
            })
        }

        app.config.globalProperties.$host = hostContext
        app.mount(target)

        // Back-reference so `unmount` finds the right app when the host mounts one bundle into several slots.
        const typedTarget = target as MountTarget
        typedTarget.__sporaApp = {
            app,
            unmount: () => {
                disposed = true
                // The host router outlives this app, so a listener left behind would push into a
                // router whose element is gone.
                unregisterHostRoute?.()
                app.unmount()
            },
        }
    },

    unmount(target: HTMLElement): void {
        const typedTarget = target as MountTarget
        if (typedTarget.__sporaApp) {
            typedTarget.__sporaApp.unmount()
            delete typedTarget.__sporaApp
        }
    },
}

// The IIFE lib wrapper assigns this at build time; assigning here also covers the dev entry.
window.SporaAppCustomSkills = SporaApp

export default SporaApp
