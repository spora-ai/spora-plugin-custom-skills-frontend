/**
 * Principals API client.
 *
 * Wire shape matches `GET /api/v1/principals/me` from spora-core.
 * Returns the principals the caller can act as (their own
 * user-principal + group-principals they're a member of) so the chip
 * row can label entries without a second round-trip.
 */
import { getApi } from './client'

export interface Principal {
    id: number
    type: 'user' | 'group'
    name: string
    user_id: number | null
    group_id: number | null
}

export async function listMyPrincipals(): Promise<Principal[]> {
    const api = getApi()
    const result = await api.get<{ principals: Principal[] }>('/principals/me')
    return result.principals
}
