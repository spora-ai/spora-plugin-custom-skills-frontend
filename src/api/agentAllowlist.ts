/**
 * Per-agent `allowed_skills` read/write for the `skill` tool.
 *
 * `allowed_skills` is a JSON-encoded string in the agent's tool override
 * (`PUT /agents/{id}/tools/skill/override`) — the host's multi-select convention,
 * mirrored from `spora-frontend/src/composables/useBundledSkills.ts`. Reads parse
 * it, writes stringify it, and every write is a read-modify-write so slugs the
 * operator (or `recommendsSkills`) already added survive.
 *
 * This is the write behind the card's "Enable on agent…" control; without it the
 * only feedback is the agent's "not in the allowed_skills list" rejection.
 */
import { getApi } from './client'

const SKILL_TOOL = 'skill'

function settingsPath(agentId: number, query = ''): string {
    const base = `/agents/${agentId}/tools/${SKILL_TOOL}/override`
    return query === '' ? base : `${base}?${query}`
}

function unionUnique(current: string[], additions: string[]): string[] {
    const seen = new Set(current)
    const out = [...current]
    for (const slug of additions) {
        if (seen.has(slug)) continue
        seen.add(slug)
        out.push(slug)
    }
    return out
}

export async function readAgentAllowedSkills(agentId: number): Promise<string[]> {
    const api = getApi()
    // `?raw=true` skips the controller's `{value, source}` annotation wrapper;
    // without it `JSON.parse` would receive an object rather than a string.
    const result = await api.get<{ settings: Record<string, string> }>(
        settingsPath(agentId, 'raw=true'),
    )
    const raw = result.settings?.['allowed_skills']
    if (typeof raw !== 'string' || raw === '') return []
    try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : []
    } catch {
        // A hand-edited override can leave a non-JSON string; the next PUT
        // overwrites it, so treat it as no allowlist rather than failing.
        return []
    }
}

async function writeAllowlist(agentId: number, next: string[]): Promise<void> {
    const api = getApi()
    await api.put(settingsPath(agentId), {
        settings: { allowed_skills: JSON.stringify(next) },
    })
}

export async function addSkillsToAgentAllowlist(
    agentId: number,
    slugs: string[],
): Promise<string[]> {
    const current = await readAgentAllowedSkills(agentId)
    const next = unionUnique(current, slugs)
    await writeAllowlist(agentId, next)
    return next
}

export async function removeSkillsFromAgentAllowlist(
    agentId: number,
    slugs: string[],
): Promise<string[]> {
    const current = await readAgentAllowedSkills(agentId)
    const removeSet = new Set(slugs)
    const next = current.filter((s) => !removeSet.has(s))
    await writeAllowlist(agentId, next)
    return next
}
