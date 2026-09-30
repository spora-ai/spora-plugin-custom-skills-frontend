/**
 * Agents API client.
 *
 * Surfaces `/agents` with optional `?principal_id=` filtering so the
 * "Enable on agent…" control can only offer agents the caller owns
 * under the active principal. Multiple ids go on as repeatable query
 * keys, matching the host's `useAgentStore.fetchAgents(principalIds)`
 * convention exactly.
 *
 * Nothing here reaches beyond the plugin's shared `api/client.ts` host
 * bridge, so tests can mock this module or stub `hostContext.api`.
 */
import { getApi } from './client'
import type { AgentSummary } from '../types'

export async function listAgents(principalIds?: number[] | null): Promise<AgentSummary[]> {
    const api = getApi()
    const query: Record<string, number[]> = {}
    if (principalIds !== undefined && principalIds !== null && principalIds.length > 0) {
        query['principal_id'] = principalIds
    }
    const result = await api.get<{ agents: AgentSummary[] } | AgentSummary[]>('/agents', query)
    return Array.isArray(result) ? result : result.agents
}
