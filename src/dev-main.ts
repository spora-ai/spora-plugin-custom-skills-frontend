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
import HomePage from './pages/HomePage.vue'
import CreateSkillPage from './pages/CreateSkillPage.vue'
import SkillDeskPage from './pages/SkillDeskPage.vue'
import CataloguePage from './pages/CataloguePage.vue'
import SkillViewerPage from './pages/SkillViewerPage.vue'
import { HOST_CONTEXT_KEY, type PluginHostContext } from './shims'
import { setApi } from './api/client'
import { createMockApi } from './dev-mock'

// Banner so a developer doesn't waste time wondering why their backend isn't
// responding.
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

// Without `app.use(router)` the `useRoute()` inject keys are missing and the pages
// warn. Same route map as `main.ts` so both surfaces behave alike.
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

const target = document.getElementById('app')
if (target) {
    const app = createApp(App, { hostContext })
    app.use(createPinia())
    app.use(router)
    app.provide(HOST_CONTEXT_KEY, hostContext)
    app.config.globalProperties.$host = hostContext
    app.mount(target)
}
