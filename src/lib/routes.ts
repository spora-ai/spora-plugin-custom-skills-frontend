/**
 * The panel's route table — one definition, three consumers.
 *
 * `main.ts` installs it, `dev-main.ts` mirrors it for the sandbox, and the specs
 * route through it. It used to be copied into each of them, and the copies drifted:
 * a page added to one would pass every spec and still be unreachable in the app,
 * because the spec was exercising a table the app does not have. So the table lives
 * here and the copies assert against it instead of restating it.
 *
 * **Every path carries the acting principal as `p/{pid}`.** A skill belongs to
 * exactly one principal (`unique(principal_id, name)`), and the REST contract
 * resolves an absent `?principal_id=` to the caller's own user-principal rather than
 * refusing — so a URL without a principal silently reads the wrong scope. That is
 * what made a group-owned skill found through the palette report "No skill named …
 * on this principal" instead of opening.
 *
 * Each destination therefore has two records: the scoped one and the unscoped one,
 * both rendering the same component. The unscoped pair exists because
 * `/apps/custom-skills` — what the apps dropdown links to — means "my own skills",
 * and because hrefs emitted before the principal moved into the path are still links
 * people hold. `App.vue` rewrites an unscoped path to its scoped form as soon as the
 * principal is known, so the unscoped records are transient rather than a second
 * way of being somewhere.
 *
 * `/new` and `/p/{principalId}/new` are deliberately separate from the `skill/`
 * subtree: a skill literally named `new` is a legal slug, and putting the create
 * form at `/skills/new` would shadow it.
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
 * Narrower than `RouteRecordRaw` on purpose. That type is a union whose members
 * disagree about which fields are required — spreading one of its members into a new
 * object loses the guarantee that `component` is there, and every consumer then has
 * to re-assert it. Every route in this panel is a plain component route, so the
 * shape is stated once here and widened at the single point the router consumes it.
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
 * Every route, in one array.
 *
 * The specs' stub table swaps the components for empty stubs but keeps the paths and
 * names, so a spec asserts against the real route names rather than a private copy
 * that can drift from what the app installs.
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
]