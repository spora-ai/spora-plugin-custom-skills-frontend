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

export async function listMyPrincipals(): Promise<Principal[]> {
    const api = getApi()
    const result = await api.get<{ principals: Principal[] }>('/principals/me')
    return result.principals
}
