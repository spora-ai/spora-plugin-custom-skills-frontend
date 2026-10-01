import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from './App.vue'
import SkillsPage from './pages/SkillsPage.vue'
import { setApi } from './api/client'
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

        // The selected skill is a *location*, not local state: it has to survive a
        // pane re-render, be linkable from the host's breadcrumbs and let the
        // operator go "back" after opening an editor. Memory history keeps the URL
        // out of the address bar — the host renders `/apps/custom-skills`.
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/', name: 'skills', component: SkillsPage },
                { path: '/:name', name: 'skill', component: SkillsPage },
            ],
        })
        app.use(router)

        // Reachable as `this.$host`, without a provide/inject key the host uses.
        app.config.globalProperties.$host = hostContext
        app.mount(target)

        // Back-reference so `unmount` finds the right app when the host mounts one
        // bundle into several slots.
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

// The IIFE lib wrapper assigns this at build time; assigning here also covers the
// dev entry, which skips `vite build --lib`.
window.SporaAppCustomSkills = SporaApp

export default SporaApp
