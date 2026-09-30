import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from './App.vue'
import SkillsPage from './pages/SkillsPage.vue'
import { setApi } from './api/client'
import { HOST_CONTEXT_KEY, type PluginHostContext } from './shims'

/**
 * Plugin mount/unmount contract.
 *
 * The IIFE lib wrapper installs this on `window.SporaAppCustomSkills`.
 * The host's `apps/registry.ts` reads
 * `window.SporaAppCustomSkills.mount` and `unmount` and calls them when
 * `/apps/custom-skills` is mounted/unmounted.
 *
 * Important: the plugin uses a *local* Pinia instance and a *local*
 * Vue Router instance (with `createMemoryHistory`, since we never own
 * the browser address bar). Plugin-only state (the skills list, the
 * active principal, the two pane search terms) lives here so it
 * doesn't pollute the host's stores. Host services (auth, theme) are
 * reached via the passed-in `hostContext.api` and `setApi(...)`
 * initializes the bridge.
 *
 * `mount()` may be sync or async. The registry awaits the return value
 * when it looks like a thenable, so plugins can do async setup before
 * returning.
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
        // Wire the host's typed REST client into the plugin-local
        // `getApi()` container so `api/customSkills.ts` and the
        // composables can reach it without a global Pinia.
        setApi(hostContext.api)

        const app = createApp(App, { hostContext })

        // Provide hostContext via Vue's inject API so `<script setup>`
        // descendants (SkillEditor, SkillsPage) can
        // `inject(HOST_CONTEXT_KEY)` without prop-drilling through
        // every layer.
        app.provide(HOST_CONTEXT_KEY, hostContext)

        // Plugin-local Pinia for plugin-only state.
        app.use(createPinia())

        // Plugin-local router. The panel is a single page, but the
        // selected skill is a *location*, not a piece of local state:
        // it has to survive a pane re-render, be linkable from the
        // host's breadcrumbs, and let the operator go "back" after
        // opening an editor. `createMemoryHistory` keeps the URL out of
        // the browser address bar — the host owns that and renders
        // `/apps/custom-skills` itself.
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/', name: 'skills', component: SkillsPage },
                { path: '/:name', name: 'skill', component: SkillsPage },
            ],
        })
        app.use(router)

        // Stash the host's Pinia on `globalProperties` so any component
        // can reach it via `this.$host` without polluting `provide`/
        // `inject` keys that the host also uses.
        app.config.globalProperties.$host = hostContext
        app.mount(target)

        // Keep a back-reference so `unmount` can find the right app
        // even if the host mounts the same bundle into multiple slots.
        const typedTarget = target as MountTarget
        typedTarget.__sporaApp = {
            app,
            unmount: () => {
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

// Vite's IIFE lib wrapper installs the value at `window.<lib.name>`
// when `build.lib.name = 'SporaAppCustomSkills'`. We additionally
// assign here for the dev-mode entry (which doesn't go through
// `vite build --lib`).
window.SporaAppCustomSkills = SporaApp

export default SporaApp
