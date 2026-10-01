/**
 * Agents API client. `principal_id` goes on as a repeatable query key, matching
 * the host's `useAgentStore.fetchAgents(principalIds)` convention, so the "Enable
 * on agent…" control can only offer agents under the active principal.
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
