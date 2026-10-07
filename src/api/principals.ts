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
 * The `?? []` is not defensive padding — it is what keeps a store from holding
 * `undefined`. Every consumer of this list reaches into it immediately (the default
 * principal, the per-entry counts, and now the URL's principal check), so a missing
 * envelope has to degrade to "no principal is visible" rather than throwing inside a
 * layout that is mid-render. The API layer is where that belongs: the alternative is
 * a `?? []` at each of those call sites, which is how the same gap gets reintroduced.
 */
export async function listMyPrincipals(): Promise<Principal[]> {
    const api = getApi()
    const result = await api.get<{ principals: Principal[] }>('/principals/me')
    return result.principals ?? []
}
