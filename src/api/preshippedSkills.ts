/**
 * Pre-shipped skills API client — reads the HOST's catalogue.
 *
 * Pre-shipped skills are served by `spora-core`'s `SkillController` at
 * `GET /api/v1/skills`, NOT by this plugin. The frozen contract is
 * explicit about it ("Not endpoints (deliberately)"): re-fetching them
 * from the plugin would produce a second, drifting copy of the truth.
 * The request therefore goes through the same host api client — we just
 * point it at the host's route.
 *
 * Read-only by design. The only mutation this panel can perform on a
 * pre-shipped skill is `Duplicate`, which POSTs a *copy* onto the
 * principal (see `api/customSkills.ts → forkSkill`).
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
