/**
 * Principals API client — `GET /api/v1/principals/me` returns the principals the
 * caller can act as, so the chip row can label them without a second round-trip.
 */
import { getApi } from './client'

export interface Principal {
    id: number
    type: 'user' | 'group'
    name: string
    user_id: number | null
    group_id: number | null
}

/**
 * The principals the caller can act as, or `[]` when the envelope is not there.
 *
 * The `?? []` is not defensive padding: every consumer reaches into this list
 * immediately, so a missing envelope must degrade to "no principal is visible" rather
 * than throw mid-render. Doing it here beats a `?? []` at each of those call sites.
 */
export async function listMyPrincipals(): Promise<Principal[]> {
    const api = getApi()
    const result = await api.get<{ principals: Principal[] }>('/principals/me')
    return result.principals ?? []
}
