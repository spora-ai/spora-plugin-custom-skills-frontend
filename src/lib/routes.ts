/**
 * The panel's route table — one definition, three consumers (`main.ts`, `dev-main.ts`, the specs).
 * It used to be copied into each, and a page added to one copy was unreachable.
 *
 * **Every path carries the acting principal as `p/{pid}`** — see `lib/hostRoute.ts` for why. Each
 * destination therefore has a scoped and an unscoped record rendering the same component: the
 * unscoped one because `/apps/custom-skills` means "my own skills" and pre-`p/{pid}` hrefs are
 * still links people hold. `App.vue` rewrites an unscoped path as soon as the principal is known,
 * so those records are transient, not a second way of being somewhere.
 *
 * `/new` is deliberately outside the `skill/` subtree: a skill named `new` is a legal slug, and
 * `/p/{id}/skill/new` would shadow it.
 */
import type { Component } from 'vue'
import type { RouteRecordRaw } from 'vue-router'
import HomePage from '../pages/HomePage.vue'
import CreateSkillPage from '../pages/CreateSkillPage.vue'
import SkillDeskPage from '../pages/SkillDeskPage.vue'
import CataloguePage from '../pages/CataloguePage.vue'
import SkillViewerPage from '../pages/SkillViewerPage.vue'

/** Narrower than `RouteRecordRaw`, whose union members disagree about which fields are required. */
export interface PanelRoute {
    path: string
    name: string
    component: Component
}

export function panelRoutes(): RouteRecordRaw[] {
    return PANEL_ROUTES.map(({ path, name, component }) => ({ path, name, component }))
}

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
    // A mistyped path matched no record and rendered an empty panel. Home is the honest landing, and
    // a component rather than a redirect so the typed URL survives.
    { path: '/:pathMatch(.*)*', name: 'not-found', component: HomePage },
]
