/**
 * This instance's tool registry, read from the HOST (`GET /api/v1/tools`).
 *
 * A skill's `allowed-tools` declares names from this set, so the editor cannot
 * know its own options without it — the set is whatever is installed, and that
 * changes with the deployment rather than with the code. It is also the only way
 * the desk can tell a declared name from a typo: a name absent here is a tool this
 * instance cannot resolve, which is what the disabled row says.
 *
 * The `{ tools }` subfield is opened here, as in `preshippedSkills.ts` — the host's
 * client has already taken the `{ data: … }` layer off, but the controller's own
 * envelope is still on the response.
 *
 * Routed through the plugin-local `getApi()` container like every other `api/*`
 * module, so CSRF and the `/api/v1` base are the host's.
 */
import { getApi } from './client'
import type { ToolSummary } from '../types'

export async function listTools(): Promise<ToolSummary[]> {
    const api = getApi()
    const result = await api.get<{ tools: ToolSummary[] }>('/tools')
    return result.tools
}
