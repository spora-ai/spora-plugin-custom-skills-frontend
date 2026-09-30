/**
 * Custom Skills API client.
 *
 * Every route here is frozen in
 * https://docs.spora-ai.com/reference/api#custom-skills-spora-plugin-custom-skills
 * — do not invent endpoints, rename fields, or relax the status codes
 * without updating the contract first.
 *
 * We route through the plugin-local `getApi()` container so the host's
 * `hostContext.api` is used verbatim — that preserves CSRF tokens, the
 * `/api/v1` base, and the `{ data: T }` envelope unwrap. Tests stub
 * `hostContext.api` and exercise these functions against it.
 *
 * Every function takes an optional `principalId` — the principal the
 * operator selected in `PrincipalChipRow`. When set it's threaded onto
 * the URL as `?principal_id=N`; the controller honours it when the
 * caller can write to that principal (own user-principal, or a
 * group-principal they own/admin) and 403s otherwise. Absent → the
 * caller's own user-principal.
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

/**
 * Build a path with the optional `?principal_id=` entry. Encoded once
 * so every API call looks identical.
 */
function withQuery(path: string, principalId: number | null): string {
    return principalId === null ? path : `${path}?principal_id=${principalId}`
}

/**
 * `{path}` in a sidecar GET is the *rest* of the path, percent-encoded
 * by the client (`examples%2Finvoice.md`). Encoding the whole segment
 * with `encodeURIComponent` also escapes the slashes, which is what the
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
 * Delete returns the agents whose `allowed_skills` the write scrubbed
 * (D11). The store hands them to the confirmation dialog so the blast
 * radius is stated *before* the operator commits, and returned to the
 * caller afterwards so the UI can report what actually changed.
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
 * Restores `previous_snapshot` in one step. The server re-snapshots
 * the current state first, so restore is itself undoable — there is no
 * "one level only, and it's gone" footgun.
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
 * Which agents currently resolve this skill through the `skill` tool's
 * `allowed_skills`. `scope: 'principal'` means the agent inherits the
 * principal-level default rather than carrying its own entry — the
 * delete dialog treats both as blast radius, but labels them
 * differently so the operator knows which knob to turn to bring it back.
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
 * Fork a pre-shipped skill onto the acting principal.
 *
 * There is no dedicated fork endpoint — the contract's "Not endpoints"
 * section rules one out. A fork is a plain `POST /custom-skills` whose
 * body is the shipped skill's frontmatter + body + sidecars under a
 * new, non-reserved name. The name rewrite is what makes this safe:
 * `POST` answers 409 `SKILL_NAME_RESERVED` for a name that collides
 * with a shipped skill, so the caller must not reuse the source slug.
 */
export async function forkSkill(
    principalId: number | null,
    data: CreateSkillDto,
): Promise<CustomSkillResource> {
    return createSkill(principalId, data)
}
