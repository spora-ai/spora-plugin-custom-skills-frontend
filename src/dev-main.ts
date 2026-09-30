/**
 * Dev-only entry. Boots the same component tree as the production
 * bundle but renders it into `#app` instead of the host's plugin slot,
 * with a mock host context that lets the UI load data without a
 * backend.
 *
 * The mock API + fixtures live in `./dev-mock` so they can be
 * unit-tested without triggering this bootstrap. The production bundle
 * (`./main.ts`) is unaffected.
 *
 * For end-to-end testing against a real backend, run the host dev
 * flow:
 *   1. PHP at :8080 (`composer dev` in spora-local)
 *   2. Plugin dev at :5190 (`npm run dev` here)
 *   3. Host SPA at :5173 (`npm run dev` in spora-frontend)
 * The host's `vite.config.ts → SPORA_PLUGIN_DEV_PORTS` then forwards
 * `/api` to PHP and `/plugins/custom-skills/*` to this dev server.
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import App from './App.vue'
import SkillsPage from './pages/SkillsPage.vue'
import { HOST_CONTEXT_KEY, type PluginHostContext } from './shims'
import { setApi } from './api/client'
import { createMockApi } from './dev-mock'

// One-line banner so the developer knows they're in sandbox mode and
// doesn't waste time wondering why their real backend isn't responding.
console.info('[spora/custom-skills] dev sandbox — using in-memory fixtures (no backend)')

const mockApi = createMockApi()
setApi(mockApi)

const hostContext: PluginHostContext = {
    api: mockApi,
    pinia: createPinia(),
    theme: 'light',
    route: { path: '/apps/custom-skills', params: {}, query: {} },
    router: {
        push: async () => undefined,
        currentRoute: { value: { path: '/apps/custom-skills' } },
    },
}

// Plugin-local router mirroring the production slot — without
// `app.use(router)` the `useRoute()` inject keys are missing and
// `SkillsPage` emits `[Vue warn]: injection "Symbol(route
// location)" not found`. Same route names as `main.ts` so the page
// behaves identically in both surfaces.
const router = createRouter({
    history: createMemoryHistory(),
    routes: [
        { path: '/', name: 'skills', component: SkillsPage },
        { path: '/:name', name: 'skill', component: SkillsPage },
    ],
})

const target = document.getElementById('app')
if (target) {
    const app = createApp(App, { hostContext })
    app.use(createPinia())
    app.use(router)
    // Mirror `src/main.ts → mount()` so the dev sandbox presents the
    // same Vue inject() tree as the production slot.
    app.provide(HOST_CONTEXT_KEY, hostContext)
    app.config.globalProperties.$host = hostContext
    app.mount(target)
}
