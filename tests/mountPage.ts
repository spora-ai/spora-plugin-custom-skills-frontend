/**
 * Mounts a page inside the panel's real dependencies: the plugin-local Pinia and
 * the plugin-local memory-history router.
 *
 * The router matters. The panel is page-per-destination, so a page mounted
 * without one renders `RouterLink`s as bare elements and `useRoute()` reads
 * `START_LOCATION` — which is how a test ends up asserting against a component
 * that could never be reached in the app.
 */
import { vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import type { Component } from 'vue'
import type { Pinia } from 'pinia'
import { PANEL_ROUTES } from '../src/lib/routes'
import { HOST_CONTEXT_KEY, type PluginHostContext } from '../src/shims'

/**
 * The real route table with empty components. Derived from `PANEL_ROUTES` rather than
 * restated, so a spec always routes through the paths and names the app installs — it
 * used to be a hand-copied table, and the copies drifted.
 */
export function stubRoutes(): Router {
    const stub = { template: '<div />' }
    return createRouter({
        history: createMemoryHistory(),
        routes: PANEL_ROUTES.map(({ path, name }) => ({ path, name, component: stub })),
    })
}

/** The route names the app installs, for specs that assert on the resolved route. */
export function panelRouteNames(): string[] {
    return PANEL_ROUTES.map((route) => route.name)
}

function hostContext(): PluginHostContext {
    return {
        api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
        pinia: null,
        theme: 'light',
        route: null,
        router: null,
    }
}

export function mountPage(component: Component, pinia: Pinia, router: Router = stubRoutes()): VueWrapper {
    return mount(component, {
        global: {
            plugins: [pinia, router],
            provide: { [HOST_CONTEXT_KEY as symbol]: hostContext() },
        },
    })
}