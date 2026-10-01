/**
 * Wire shapes mirroring the published REST contract in
 * https://docs.spora-ai.com/reference/api#custom-skills-spora-plugin-custom-skills
 * field for field. The PHP `CustomSkillResource` serialiser is the other half of
 * this pair and the two are not derivable from each other, so do not rename or
 * re-type anything without updating the contract.
 */

/** `SKILL.md` is always index 0 — the cards read the body size from `files[0]`. */
export interface CustomSkillFile {
    path: string
    bytes: number
}

/** `agent` = an agent ran `manage_skill`; `human` = an operator used this panel. */
export type SkillProvenance = 'human' | 'agent'

/**
 * `path` is the frontmatter key the finding applies to, and is what the editor
 * matches on to place the message under the right field. Without one, the finding
 * can only go to the warnings banner.
 */
export interface SkillValidationEntry {
    code: string
    severity: 'error' | 'warning' | string
    message: string
    path?: string
}

export interface CustomSkillResource {
    id: number
    principal_id: number
    name: string
    slug: string
    description: string
    license: string | null
    compatibility: string | null
    /** The hyphenated `allowed-tools` frontmatter value, verbatim. */
    allowed_tools: string | null
    /** Always an object; `{}` when unset. */
    metadata: Record<string, unknown>
    /** The SKILL.md body with the frontmatter fence stripped. */
    body: string
    body_bytes: number
    provenance: SkillProvenance
    created_by_user_id: number
    updated_by_user_id: number
    /** `YYYY-MM-DD HH:MM:SS` in the server's own timezone. */
    created_at: string
    updated_at: string
    files: CustomSkillFile[]
    /** `previous_snapshot` exists → "Restore previous version" is offered. */
    has_previous: boolean
    warnings: SkillValidationEntry[]
    warning_count: number
}

export interface CreateSkillDto {
    name: string
    description: string
    body: string
    license?: string | null
    compatibility?: string | null
    allowed_tools?: string | null
    metadata?: Record<string, unknown>
    /** Path → content. Fully replaces the sidecar set. */
    files?: Record<string, string>
}

/**
 * `name` is deliberately absent — the contract rejects a rename with 422
 * `VALIDATION_ERROR`.
 */
export type UpdateSkillDto = Omit<CreateSkillDto, 'name'>

export interface DeleteSkillResult {
    deleted: boolean
    name: string
    /**
     * Agent-level only — the principal-level default is scrubbed silently. The
     * delete confirmation names these BEFORE the write, because a delete is a
     * multi-agent config change the operator would otherwise only discover from
     * a failing agent run.
     */
    scrubbed_agents: Array<{ id: number; name: string }>
}

export interface SkillAllowlistEntry {
    id: number
    name: string
    /** `agent` = agent override, `principal` = inherited default. */
    scope: 'agent' | 'principal'
}

export interface SkillFileContent {
    path: string
    content: string
    bytes: number
}

/**
 * From the HOST (`GET /api/v1/skills`), never this plugin — the frozen contract
 * lists them under "Not endpoints". Mirrors `spora-frontend/src/types/skill.ts` so
 * both UIs agree on field names.
 */
export interface PreShippedSkillSummary {
    name: string
    description: string
    /** `project`, `core`, or a plugin slug. */
    source: string
    license: string | null
    files_count: number
    has_warnings: boolean
}

export interface PreShippedSkillDetail {
    name: string
    description: string
    license: string | null
    compatibility: string | null
    metadata: Record<string, string>
    allowed_tools: string | null
    body: string
    body_bytes: number
    files: CustomSkillFile[]
    warnings: SkillValidationEntry[]
}

export interface AgentSummary {
    id: number
    name: string
}
