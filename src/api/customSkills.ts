/**
 * Custom Skills API client. Every route is frozen in
 * https://docs.spora-ai.com/reference/api#custom-skills-spora-plugin-custom-skills
 * — do not invent endpoints or status codes without updating the contract first.
 *
 * Routed through the plugin-local `getApi()` container so the host's client is
 * used verbatim. `principalId` is threaded onto the URL as `?principal_id=N`; the
 * controller honours it when the caller can write to that principal and 403s
 * otherwise, and absent → the caller's own user-principal.
 */
import { getApi } from './client'
import type {
    CreateSkillDto,
    CustomSkillFile,
    CustomSkillResource,
    DeleteSkillResult,
    SkillAllowlistEntry,
    SkillFileContent,
    UpdateSkillDto,
} from '../types'

const BASE = '/custom-skills'

function withQuery(path: string, principalId: number | null): string {
    return principalId === null ? path : `${path}?principal_id=${principalId}`
}

/**
 * `{path}` in a sidecar GET is the *rest* of the path, percent-encoded by the
 * client — `encodeURIComponent` escapes the slashes too, which is what the
 * Symfony router needs to treat it as one parameter.
 */
function encodeFilePath(filePath: string): string {
    return encodeURIComponent(filePath)
}

export async function listSkills(principalId: number | null): Promise<CustomSkillResource[]> {
    const api = getApi()
    const result = await api.get<{ skills: CustomSkillResource[] }>(withQuery(BASE, principalId))
    return result.skills
}

export async function getSkill(
    name: string,
    principalId: number | null,
): Promise<CustomSkillResource> {
    const api = getApi()
    const result = await api.get<{ skill: CustomSkillResource }>(
        withQuery(`${BASE}/${encodeURIComponent(name)}`, principalId),
    )
    return result.skill
}

export async function createSkill(
    principalId: number | null,
    data: CreateSkillDto,
): Promise<CustomSkillResource> {
    const api = getApi()
    const result = await api.post<{ skill: CustomSkillResource }>(withQuery(BASE, principalId), data)
    return result.skill
}

export async function updateSkill(
    name: string,
    principalId: number | null,
    data: UpdateSkillDto,
): Promise<CustomSkillResource> {
    const api = getApi()
    const result = await api.put<{ skill: CustomSkillResource }>(
        withQuery(`${BASE}/${encodeURIComponent(name)}`, principalId),
        data,
    )
    return result.skill
}

/**
 * Returns the agents whose `allowed_skills` the write scrubbed (D11) — for
 * reporting *after* the write; the pre-confirmation blast radius is a separate
 * allowlist read.
 */
export async function deleteSkill(
    name: string,
    principalId: number | null,
): Promise<DeleteSkillResult> {
    const api = getApi()
    return api.delete<DeleteSkillResult>(
        withQuery(`${BASE}/${encodeURIComponent(name)}`, principalId),
    )
}

/**
 * The server re-snapshots the current state first, so restore is itself undoable —
 * there is no "one level only, and it's gone" footgun.
 */
export async function restoreSkill(
    name: string,
    principalId: number | null,
): Promise<CustomSkillResource> {
    const api = getApi()
    const result = await api.post<{ skill: CustomSkillResource }>(
        withQuery(`${BASE}/${encodeURIComponent(name)}/restore`, principalId),
        {},
    )
    return result.skill
}

export async function listSkillFiles(
    name: string,
    principalId: number | null,
): Promise<CustomSkillFile[]> {
    const api = getApi()
    const result = await api.get<{ files: CustomSkillFile[] }>(
        withQuery(`${BASE}/${encodeURIComponent(name)}/files`, principalId),
    )
    return result.files
}

/** 413 `FILE_TOO_LARGE` when the member exceeds the 50 000-byte cap. */
export async function getSkillFile(
    name: string,
    filePath: string,
    principalId: number | null,
): Promise<SkillFileContent> {
    const api = getApi()
    const result = await api.get<SkillFileContent>(
        withQuery(
            `${BASE}/${encodeURIComponent(name)}/files/${encodeFilePath(filePath)}`,
            principalId,
        ),
    )
    return result
}

/**
 * `scope: 'principal'` means the agent inherits the principal-level default rather
 * than carrying its own entry. The delete dialog counts both as blast radius but
 * labels them differently, so the operator knows which knob turns it back off.
 */
export async function getSkillAllowlist(
    name: string,
    principalId: number | null,
): Promise<SkillAllowlistEntry[]> {
    const api = getApi()
    const result = await api.get<{ agents: SkillAllowlistEntry[] }>(
        withQuery(`${BASE}/${encodeURIComponent(name)}/allowlist`, principalId),
    )
    return result.agents
}

/**
 * There is no dedicated fork endpoint — the contract's "Not endpoints" section
 * rules one out. A fork is a plain `POST /custom-skills` carrying the shipped
 * skill's frontmatter + body + sidecars under a new, non-reserved name: `POST`
 * answers 409 `SKILL_NAME_RESERVED` for a name that collides with a shipped skill.
 */
export async function forkSkill(
    principalId: number | null,
    data: CreateSkillDto,
): Promise<CustomSkillResource> {
    return createSkill(principalId, data)
}
