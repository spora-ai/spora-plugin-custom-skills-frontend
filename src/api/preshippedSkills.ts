/**
 * Pre-shipped skills API client — reads the HOST's catalogue at
 * `GET /api/v1/skills`, which the contract lists under "Not endpoints
 * (deliberately)": re-serving it here would produce a second, drifting copy.
 * Read-only; the only mutation is Duplicate, which POSTs a *copy* onto the
 * principal.
 */
import { getApi } from './client'
import type { PreShippedSkillDetail, PreShippedSkillSummary } from '../types'

export async function listPreShippedSkills(): Promise<PreShippedSkillSummary[]> {
    const api = getApi()
    const result = await api.get<{ skills: PreShippedSkillSummary[] }>('/skills')
    return result.skills
}

export async function getPreShippedSkill(name: string): Promise<PreShippedSkillDetail> {
    const api = getApi()
    const result = await api.get<{ skill: PreShippedSkillDetail; source: string }>(
        `/skills/${encodeURIComponent(name)}`,
    )
    return result.skill
}
