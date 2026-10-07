/**
 * Vue `InjectionKey` for the host context, defined once for every bootstrap path
 * (`main.ts`, `dev-main.ts`) — per-entry symbols surfaced as
 * `[Vue warn]: injection "Symbol(...)" not found` with `hostContext` `undefined`.
 */
import type { InjectionKey } from 'vue'

export const HOST_CONTEXT_KEY: InjectionKey<PluginHostContext> = Symbol(
    'spora-custom-skills-host-context',
) as unknown as InjectionKey<PluginHostContext>

/**
 * The deliberately small context the host's `PluginAppPage.vue` passes:
 *   - `api`    — the host's typed REST client, used verbatim so request/response
 *                shapes stay in sync with the host's `/api/v1` envelope.
 *   - `pinia`  — the host's Pinia. Plugins may install a *local* Pinia but must
 *                NOT call `setActivePinia(host.pinia)`: that collides with the
 *                host's stores. Reach host state with
 *                `useSomeHostStore(host.pinia)`.
 *   - `theme`  — a mount-time `'light' | 'dark'` snapshot. The host remounts the
 *                slot on re-theme, so plugins read it once and trust it.
 *   - `route`  — the host's current route, for breadcrumbs and back-links.
 *   - `router` — the host's Vue Router, for client-side navigation.
 */
export interface PluginHostContext {
    /**
     * The host's `request<T>()` already unwrapped the `{ data: T }` envelope; the
     * `{ skills }` / `{ skill }` subfield envelopes are opened by the api layer,
     * since the PHP controllers return them.
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
    /** The host exposes the full Router, but plugins only see this surface. */
    router: {
        push: (to: string) => Promise<unknown>
        currentRoute: { value: { path: string; params?: Record<string, unknown>; query?: Record<string, unknown> } }
        /**
         * Optional because it is read defensively at runtime, not because the host
         * lacks it — the host hands over a real Vue Router. Watching
         * `currentRoute` reactively does not work from inside a plugin (separate
         * `vue` copies, so the host's `shallowRef` sits behind a proxy that does
         * not subscribe to it); `afterEach` is the imperative way out, and
         * `spora-plugin-media-archive` reaches for the same one. Declared here so
         * this does not need a cast.
         */
        afterEach?: (cb: (to: { path: string; query?: Record<string, unknown> }) => void) => () => void
    } | null
}

declare global {
    interface Window {
        SporaAppCustomSkills?: {
            /**
             * Async, and must stay so: the panel is mounted onto a host URL that may
             * already name a principal and a skill, and it cannot render before that
             * navigation resolves. The host registry awaits a thenable return.
             */
            mount: (target: HTMLElement, ctx: PluginHostContext) => Promise<void>
            unmount?: (target: HTMLElement) => void
        }
    }
}
