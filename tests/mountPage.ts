/**
 * Mounts a page inside the panel's real dependencies. The router matters — without one, `RouterLink`s
 * render as bare elements and `useRoute()` reads `START_LOCATION`, so a test asserts against a page
 * unreachable in the app.
 */
import { vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import type { Component } from 'vue'
import type { Pinia } from 'pinia'
import { PANEL_ROUTES } from '../src/lib/routes'
import { HOST_CONTEXT_KEY, type PluginHostContext } from '../src/shims'

/** Derived from `PANEL_ROUTES`, so a spec always routes through the app's own table. */
export function stubRoutes(): Router {
    const stub = { template: '<div />' }
    return createRouter({
        history: createMemoryHistory(),
        routes: PANEL_ROUTES.map(({ path, name }) => ({ path, name, component: stub })),
    })
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
