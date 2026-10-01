/**
 * Plugin-local bridge to the host's typed REST client, which owns CSRF, the
 * `/api/v1` base and the `{ data: T }` unwrap. `setApi()` installs the instance
 * the registry hands `mount()`; `getApi()` serves every `api/*` module. Tests
 * either `vi.mock()` this module or `setApi()` a stub.
 */
import type { PluginHostContext } from '../shims'

let _api: PluginHostContext['api'] | null = null

export function setApi(api: PluginHostContext['api']): void {
    _api = api
}

export function getApi(): PluginHostContext['api'] {
    if (_api === null) {
        throw new Error('Plugin API not initialized — call setApi() in main.ts before mounting the plugin.')
    }
    return _api
}

export class ApiError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly status: number,
    ) {
        super(message)
        this.name = 'ApiError'
    }
}
