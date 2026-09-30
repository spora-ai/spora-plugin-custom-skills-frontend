/**
 * Vue `InjectionKey` for the host context. Components deep in the
 * plugin tree (the page, the editor) `inject(HOST_CONTEXT_KEY)` to
 * reach host-only contracts without prop-drilling.
 *
 * Defined once and imported by every bootstrap path (`src/main.ts`
 * for the production mount, `src/dev-main.ts` for the standalone dev
 * sandbox). The production entry and the dev entry used to declare
 * their own symbols independently, which surfaced as
 * `[Vue warn]: injection "Symbol(...)" not found` and left
 * `hostContext` `undefined` in descendants.
 */
import type { InjectionKey } from 'vue'

export const HOST_CONTEXT_KEY: InjectionKey<PluginHostContext> = Symbol(
    'spora-custom-skills-host-context',
) as unknown as InjectionKey<PluginHostContext>

/**
 * The Custom Skills SPA is mounted into a slot owned by the host's
 * `PluginAppPage.vue`. The host passes a deliberately small context:
 *   - `api`           — the host's typed REST client. We use it directly
 *                       rather than rebuilding a copy so request/response
 *                       shapes stay in sync with the host's `/api/v1`
 *                       envelope.
 *   - `pinia`         — the host's Pinia instance. Plugins may install a
 *                       *local* Pinia (for plugin-only state) but should
 *                       NOT call `setActivePinia(host.pinia)` — that
 *                       would collide with the host's stores.
 *   - `theme`         — `'light' | 'dark'` snapshot at mount time.
 *                       Plugins read this once and trust it; if the host
 *                       re-themes, the slot is unmounted and remounted,
 *                       so we get a fresh value.
 *   - `route`         — the host's current route. Plugins render under
 *                       `/apps/<slug>` already; this is for breadcrumbs
 *                       and back-links.
 *   - `router`        — the host's Vue Router instance. Plugins that
 *                       need client-side navigation call `router.push(...)`.
 *
 * Anything else (auth, runtime config, etc.) is reachable via the host's
 * Pinia stores — use `useSomeHostStore(host.pinia)` rather than reaching
 * for `useSomeHostStore()` directly, which would attach to whatever Pinia
 * is currently active in the slot.
 */
export interface PluginHostContext {
    /**
     * The host's `spora-frontend/src/api/client.ts → request<T>()` unwraps
     * the standard `{ data: T }` envelope before handing the value to the
     * caller. Plugins receive `T` directly — for the custom-skills
     * endpoints that's the unwrapped subfield (`{ skills }` / `{ skill }`
     * envelopes still need to be opened here, as the PHP controllers
     * return them).
     */
    api: {
        get: <T = unknown>(path: string, query?: Record<string, unknown>) => Promise<T>
        post: <T = unknown>(path: string, body: unknown) => Promise<T>
        put: <T = unknown>(path: string, body: unknown) => Promise<T>
        patch: <T = unknown>(path: string, body: unknown) => Promise<T>
        delete: <T = unknown>(path: string) => Promise<T>
    }
    pinia: unknown
    theme: 'light' | 'dark'
    route: { path: string; params: Record<string, unknown>; query: Record<string, unknown> } | null
    /**
     * Host's Vue Router instance. Plugins read `currentRoute` (a
     * `shallowRef`) for reactive URL tracking, and call `push(to)` for
     * client-side navigation. The host already exposes the full Router —
     * see `spora-frontend/src/apps/registry.ts → PluginHostContext` —
     * but plugins only see the surface they actually use.
     */
    router: {
        push: (to: string) => Promise<unknown>
        currentRoute: { value: { path: string; params?: Record<string, unknown>; query?: Record<string, unknown> } }
    } | null
}

declare global {
    interface Window {
        SporaAppCustomSkills?: {
            mount: (target: HTMLElement, ctx: PluginHostContext) => void | Promise<void>
            unmount?: (target: HTMLElement) => void
        }
    }
}
