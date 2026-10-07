/**
 * The panel's route table — one definition, three consumers: `main.ts` installs it,
 * `dev-main.ts` mirrors it, and the specs route through it. It used to be copied into
 * each, and the copies drifted: a page added to one passed every spec and was still
 * unreachable in the app.
 *
 * **Every path carries the acting principal as `p/{pid}`** — see `lib/hostRoute.ts` for
 * why. Each destination therefore has two records, scoped and unscoped, rendering the
 * same component: the unscoped one because `/apps/custom-skills` (the apps dropdown)
 * means "my own skills" and because pre-`p/{pid}` hrefs are still links people hold.
 * `App.vue` rewrites an unscoped path as soon as the principal is known, so the
 * unscoped records are transient rather than a second way of being somewhere.
 *
 * `/new` and `/p/{principalId}/new` are deliberately outside the `skill/` subtree: a
 * skill literally named `new` is a legal slug, and `/p/{id}/skill/new` would shadow it.
 */
import type { Component } from 'vue'
import type { RouteRecordRaw } from 'vue-router'
import HomePage from '../pages/HomePage.vue'
import CreateSkillPage from '../pages/CreateSkillPage.vue'
import SkillDeskPage from '../pages/SkillDeskPage.vue'
import CataloguePage from '../pages/CataloguePage.vue'
import SkillViewerPage from '../pages/SkillViewerPage.vue'

/**
 * One destination: a path, a route name, and the component it renders.
 *
 * Narrower than `RouteRecordRaw` on purpose: that type is a union whose members disagree
 * about which fields are required, so spreading one of its members into a new object
 * loses the guarantee that `component` is there. Every route here is a plain component
 * route, so the shape is stated once and widened where the router consumes it.
 */
export interface PanelRoute {
    path: string
    name: string
    component: Component
}

/** `PANEL_ROUTES` in the shape `createRouter` expects. */
export function panelRoutes(): RouteRecordRaw[] {
    return PANEL_ROUTES.map(({ path, name, component }) => ({ path, name, component }))
}

/**
 * Every route, in one array. The specs' stub table swaps the components for empty stubs
 * but keeps these paths and names, so a spec asserts against the route names the app
 * actually installs rather than a private copy that can drift from it.
 */
export const PANEL_ROUTES: PanelRoute[] = [
    { path: '/', name: 'home', component: HomePage },
    { path: '/p/:principalId', name: 'home-scoped', component: HomePage },
    { path: '/p/:principalId/new', name: 'create', component: CreateSkillPage },
    { path: '/new', name: 'create-unscoped', component: CreateSkillPage },
    { path: '/p/:principalId/skill/:name', name: 'desk', component: SkillDeskPage },
    { path: '/skill/:name', name: 'desk-unscoped', component: SkillDeskPage },
    { path: '/p/:principalId/library', name: 'catalogue', component: CataloguePage },
    { path: '/library', name: 'catalogue-unscoped', component: CataloguePage },
    { path: '/p/:principalId/library/:name', name: 'viewer', component: SkillViewerPage },
    { path: '/library/:name', name: 'viewer-unscoped', component: SkillViewerPage },
    // Anything else. A mistyped, stale or hand-written path used to render an empty
    // panel, because `localPathForHostPath` is a bare prefix strip and no record
    // matched. Home is the honest landing place, and the layout then scopes it. A
    // component rather than a redirect, so the URL the operator typed survives for
    // them to see while the panel shows something useful.
    { path: '/:pathMatch(.*)*', name: 'not-found', component: HomePage },
]
