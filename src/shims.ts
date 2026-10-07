/** One injection key for every bootstrap path — a per-entry symbol surfaces as
 *  `[Vue warn]: injection "Symbol(...)" not found` with `hostContext` `undefined`. */
import type { InjectionKey } from 'vue'

export const HOST_CONTEXT_KEY: InjectionKey<PluginHostContext> = Symbol(
    'spora-custom-skills-host-context',
) as unknown as InjectionKey<PluginHostContext>

/**
 * The deliberately small context the host's `PluginAppPage.vue` passes:
 *   - `api`    — the host's typed REST client, used verbatim so shapes stay in sync with the host's
 *                `/api/v1` envelope. `{ skills }` / `{ skill }` subfield envelopes are opened by the api layer.
 *   - `pinia`  — the host's Pinia. Plugins may install a *local* Pinia but must NOT call
 *                `setActivePinia(host.pinia)`: that collides with the host's stores.
 *   - `theme`  — a mount-time snapshot; the host remounts the slot on re-theme, so read it once.
 *   - `route` / `router` — the host's current route and Vue Router.
 */
export interface PluginHostContext {
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
    /** The host exposes the full Router; plugins only see this surface. */
    router: {
        push: (to: string) => Promise<unknown>
        currentRoute: { value: { path: string; params?: Record<string, unknown>; query?: Record<string, unknown> } }
        /**
         * Optional because it is read defensively, not because the host lacks it. Watching
         * `currentRoute` reactively does not work from inside a plugin (separate `vue` copies, so the
         * host's `shallowRef` sits behind a proxy that does not subscribe to it); `afterEach` is the
         * imperative way out.
         *
         * The third argument is vue-router's `failure`. It fires for CANCELLED and aborted navigations too,
         * so a plugin syncing a URL must ignore it.
         */
       afterEach?: (
           cb: (
               to: { path: string; fullPath?: string; query?: Record<string, unknown> },
               from: unknown,
               failure?: unknown,
           ) => void,
       ) => () => void
    } | null
}

declare global {
    interface Window {
        SporaAppCustomSkills?: {
            /** Async, and must stay so: the panel may mount onto a URL that already names a skill. */
            mount: (target: HTMLElement, ctx: PluginHostContext) => Promise<void>
            unmount?: (target: HTMLElement) => void
        }
    }
}
