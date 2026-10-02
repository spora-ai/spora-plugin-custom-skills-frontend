import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from './App.vue'
import HomePage from './pages/HomePage.vue'
import CreateSkillPage from './pages/CreateSkillPage.vue'
import SkillDeskPage from './pages/SkillDeskPage.vue'
import CataloguePage from './pages/CataloguePage.vue'
import SkillViewerPage from './pages/SkillViewerPage.vue'
import { setApi } from './api/client'
import { localRouteForHostRoute } from './lib/hostRoute'
import { HOST_CONTEXT_KEY, type PluginHostContext } from './shims'

/**
 * Plugin mount/unmount contract, installed on `window.SporaAppCustomSkills` by
 * the IIFE lib wrapper; the host's `apps/registry.ts` calls it when
 * `/apps/custom-skills` is mounted/unmounted. `mount()` may be sync or async —
 * the registry awaits a thenable return, so async setup is allowed.
 *
 * The plugin uses a *local* Pinia and a *local* router (`createMemoryHistory`,
 * since the host owns the address bar) so plugin-only state never pollutes host
 * stores; host services are reached through the passed-in `hostContext.api`.
 *
 * The routes are page-per-destination: home, create, the desk, the catalogue and
 * the shipped-skill viewer. The principal is deliberately *not* in the URL — it
 * lives in the Pinia store, and a scope change navigates to home rather than
 * re-pointing a detail route at another principal's identically-named skill.
 */

interface MountContract {
    mount: (target: HTMLElement, hostContext: PluginHostContext) => void | Promise<void>
    unmount: (target: HTMLElement) => void
}

interface MountTarget extends HTMLElement {
    __sporaApp?: { unmount: () => void; app: import('vue').App }
}

const SporaApp: MountContract = {
    mount(target: HTMLElement, hostContext: PluginHostContext): void {
        // Bridge the host's typed REST client into the plugin-local `getApi()`
        // container.
        setApi(hostContext.api)

        const app = createApp(App, { hostContext })

        // Inject rather than prop-drill, so every `<script setup>` descendant
        // can reach the host context.
        app.provide(HOST_CONTEXT_KEY, hostContext)

        app.use(createPinia())

        // One page per destination, each with a subject of its own. Two of the
        // paths are deliberately not nested: `/new` is top-level because
        // `/skills/new` would shadow a skill literally named `new` (a legal slug),
        // and `/library/:name` is separate from `/skills/:name` because a shipped
        // skill is global and read-only while a custom one is principal-scoped and
        // writable.
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/', name: 'home', component: HomePage },
                { path: '/new', name: 'create', component: CreateSkillPage },
                { path: '/skills/:name', name: 'desk', component: SkillDeskPage },
                { path: '/library', name: 'catalogue', component: CataloguePage },
                { path: '/library/:name', name: 'library', component: SkillViewerPage },
            ],
        })
        app.use(router)

        // Follow the host's URL into a skill. Core's `SkillSearchProvider` links a
        // skill as `/apps/custom-skills/skill/{name}`, and the host router registers
        // no child route for that, so the panel reads the path itself — the same
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
        if (hostRouter !== null) {
            // Read once at mount for the initial value, which is what a palette hit
            // or a pasted link looks like: the app may be mounted onto a URL that
            // already names a skill.
            const initial = localRouteForHostRoute(hostRouter.currentRoute?.value ?? null)
            if (initial !== null) {
                void router.replace(initial)
            }
            unregisterHostRoute = hostRouter.afterEach?.((to) => {
                const target = localRouteForHostRoute(to)
                // Guarded on the current local path, so a host navigation that did
                // not concern this app — or a navigation this app caused — is a
                // no-op rather than a redirect loop.
                if (target === null || router.currentRoute.value.path === target) return
                void router.push(target)
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
