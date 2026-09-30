/**
 * Per-agent `allowed_skills` read/write for the `skill` tool.
 *
 * The SkillTool stores `allowed_skills` as a JSON-encoded string in its
 * per-agent override (`PUT /agents/{id}/tools/skill/override`), matching
 * the host's multi-select field convention — see
 * `spora-frontend/src/composables/useBundledSkills.ts`, which this
 * mirrors. The reads JSON-parse the value; the writes JSON-stringify
 * it. Union/subtract happen on the array level so callers never touch
 * the wire shape.
 *
 * This is the write behind the card's "Enable on agent…" control.
 * Without it the operator writes a skill, asks the agent to use it, and
 * the only thing they get back is *"Skill 'x' is not in the
 * allowed_skills list for this agent."*
 */
import { getApi } from './client'

const SKILL_TOOL = 'skill'

function settingsPath(agentId: number, query = ''): string {
    const base = `/agents/${agentId}/tools/${SKILL_TOOL}/override`
    return query === '' ? base : `${base}?${query}`
}

/** Union that preserves order and drops duplicates. */
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
    // `?raw=true` skips the controller's `{value, source}` annotation
    // wrapper and returns the flat `{key: value}` shape that matches the
    // PUT payload. Without it, `allowed_skills` arrives as
    // `{value: '[...]', source: 'agent'}` and `JSON.parse` would throw.
    const result = await api.get<{ settings: Record<string, string> }>(
        settingsPath(agentId, 'raw=true'),
    )
    const raw = result.settings?.['allowed_skills']
    if (typeof raw !== 'string' || raw === '') return []
    try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : []
    } catch {
        // A hand-edited tool override can leave a non-JSON string here.
        // Treated as "no allowlist" rather than failing the whole panel —
        // the subsequent PUT overwrites it with a well-formed value.
        return []
    }
}

async function writeAllowlist(agentId: number, next: string[]): Promise<void> {
    const api = getApi()
    await api.put(settingsPath(agentId), {
        settings: { allowed_skills: JSON.stringify(next) },
    })
}

/**
 * Add `slugs` to the agent's allowlist, preserving whatever the
 * operator (or `recommendsSkills`) already put there.
 */
export async function addSkillsToAgentAllowlist(
    agentId: number,
    slugs: string[],
): Promise<string[]> {
    const current = await readAgentAllowedSkills(agentId)
    const next = unionUnique(current, slugs)
    await writeAllowlist(agentId, next)
    return next
}

/** Remove `slugs` from the agent's allowlist. */
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
