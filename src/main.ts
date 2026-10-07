import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from './App.vue'
import { panelRoutes } from './lib/routes'
import { setApi } from './api/client'
import { appSlugFrom, hostPathForLocalPath, localPathForHostRoute } from './lib/hostRoute'
import { HOST_CONTEXT_KEY, type PluginHostContext } from './shims'

/**
 * Plugin mount/unmount contract, installed on `window.SporaAppCustomSkills` by the
 * IIFE lib wrapper; the host's `apps/registry.ts` calls it when `/apps/custom-skills`
 * is mounted/unmounted. `mount()` is async and **must stay so** — the host registry
 * awaits a thenable return, and the panel may be mounted onto a URL that already names
 * a principal and a skill, so it cannot render before that navigation resolves.
 *
 * The plugin uses a *local* Pinia and a *local* router (`createMemoryHistory`, since
 * the host owns the address bar) so plugin-only state never pollutes host stores; host
 * services are reached through the passed-in `hostContext.api`.
 *
 * **The host URL is the source of truth; the local router is a mirror of it.** Both
 * directions are kept in step below — a host navigation replaces the local route, a
 * local navigation pushes a host path — the arrangement `spora-plugin-media-archive`
 * already uses. Without the local → host direction the address bar never moves, so
 * nothing in the panel is linkable, bookmarkable or reloadable.
 *
 * `replace` in, `push` out. A host navigation has *already* been pushed onto the
 * browser's stack, so replacing the local route avoids counting it twice; a local
 * navigation is a new destination the operator chose, so it earns a history entry and
 * Back walks the panel.
 *
 * The route table lives in `lib/routes.ts`, shared with the dev entry and the specs.
 */

interface MountContract {
    mount: (target: HTMLElement, hostContext: PluginHostContext) => Promise<void>
    unmount: (target: HTMLElement) => void
}

interface MountTarget extends HTMLElement {
    __sporaApp?: { unmount: () => void; app: import('vue').App }
}

const SporaApp: MountContract = {
    /**
     * Async on purpose: the panel can be mounted onto a URL that already names a
     * principal and a skill — a palette hit, a reload, a pasted link — and `RouterView`
     * renders nothing until that navigation resolves. Mounting first would put a frame
     * of *home* in front of the operator, and worse, let the layout canonicalise the
     * URL against a route that had not settled — which is how a desk ends up replaced
     * by `/p/{id}`. The registry awaits a thenable return, so awaiting is supported.
     */
    async mount(target: HTMLElement, hostContext: PluginHostContext): Promise<void> {
        // The host mounts and unmounts this bundle repeatedly, and a target can
        // still hold a previous app. Vue's `mount()` on a non-empty container
        // tries to reconcile against an app it knows nothing about and throws
        // while tearing the old tree down, so the prior app is released first —
        // through its own `unmount()`, which also drops the host-route listener.
        (target as MountTarget).__sporaApp?.unmount()

        // Bridge the host's typed REST client into the plugin-local `getApi()`
        // container.
        setApi(hostContext.api)

        const app = createApp(App, { hostContext })

        // Inject rather than prop-drill, so every `<script setup>` descendant
        // can reach the host context.
        app.provide(HOST_CONTEXT_KEY, hostContext)

        app.use(createPinia())

        // See `lib/routes.ts` for the route map and why each path is scoped.
        const router = createRouter({
            history: createMemoryHistory(),
            routes: panelRoutes(),
        })
        app.use(router)

        // `appSlugFrom()` reads it off the host route, so another app name still works.
        const appSlug = appSlugFrom(hostContext.route)

        // Follow the host's URL into the panel, and the panel's URL back out. The host
        // registers no child route under `/apps/:appName/:rest*` for our
        // `p/{pid}/skill/{name}` shapes, so this app parses the path itself — the same
        // arrangement as `spora-plugin-media-archive`'s `lib/route-detection.ts`.
        //
        // Host navigation is listened for imperatively via `afterEach` rather than by
        // watching `hostContext.router.currentRoute`: the plugin and the host ship
        // separate `vue` copies, so when Vue wraps `hostContext` in `reactive()` for
        // the plugin's props the host's `shallowRef` ends up behind a proxy whose
        // `.value` getter does not subscribe to the ref's own deps, and a `watch` on
        // it never fires. `afterEach` is fired from the host router's navigation
        // pipeline, so it sidesteps that entirely.
        const hostRouter = hostContext.router
        let unregisterHostRoute: (() => void) | undefined
        // A push out can resolve after `unmount()` — the host router outlives this app,
        // and the host does mount and unmount this bundle repeatedly.
        let disposed = false

        // Read once at mount — what a palette hit, a reload or a pasted link looks
        // like. `isReady()` matters as much as the `replace`: `App.vue` reconciles the
        // acting principal against `route.path` on mount, and a path still at
        // `START_LOCATION` would canonicalise to `/` and replace away the desk.
        const initial = localPathForHostRoute(hostRouter?.currentRoute?.value ?? null, appSlug)
        if (initial !== null) {
            await router.replace(initial)
        }
        await router.isReady()

        if (hostRouter !== null) {
            // Host → local. Guarded on the current local path, so a host navigation
            // that did not concern this app — or one this app caused — is a no-op
            // rather than a redirect loop.
            unregisterHostRoute = hostRouter.afterEach?.((to) => {
                if (disposed) return
                const localPath = localPathForHostRoute(to, appSlug)
                if (localPath === null || router.currentRoute.value.path === localPath) return
                void router.replace(localPath)
            })

            // Local → host: the direction that was missing. Without it the address bar
            // never moves, so browsing the panel produces no link and a reload loses
            // the operator's place.
            router.afterEach((to) => {
                if (disposed) return
                const hostPath = hostPathForLocalPath(to.path, appSlug)
                const currentHostPath = hostRouter.currentRoute?.value?.path
                if (currentHostPath === undefined || currentHostPath === hostPath) return
                void hostRouter.push(hostPath)
            })
        }

        // Reachable as `this.$host`, without a provide/inject key the host uses.
        app.config.globalProperties.$host = hostContext
        app.mount(target)

        // Back-reference so `unmount` finds the right app when the host mounts one
        // bundle into several slots.
        const typedTarget = target as MountTarget
        typedTarget.__sporaApp = {
            app,
            unmount: () => {
                disposed = true
                // The host router outlives this app, so a listener left behind would
                // push into a router whose element is gone — and the host does mount
                // and unmount this bundle repeatedly.
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

// The IIFE lib wrapper assigns this at build time; assigning here also covers the
// dev entry, which skips `vite build --lib`.
window.SporaAppCustomSkills = SporaApp

export default SporaApp