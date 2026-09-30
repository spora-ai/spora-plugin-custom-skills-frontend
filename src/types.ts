/**
 * Wire shapes for the custom-skills admin panel.
 *
 * `CustomSkillResource` mirrors the frozen REST contract in
 * `spora-workspace/plans/custom-skills-rest-contract.md` field for
 * field. Do not rename or re-type anything here without updating the
 * contract — the PHP `CustomSkillResource` serialiser is the other
 * half of this pair and the two are not derivable from each other.
 */

/** One entry in a skill's file manifest. `SKILL.md` is always index 0. */
export interface CustomSkillFile {
    path: string
    bytes: number
}

/**
 * Who last wrote the skill. `agent` means an agent ran the
 * `manage_skill` tool; `human` means an operator used this panel.
 * The editor surfaces this as "Last edited by agent · 14:02" so an
 * operator can tell an automated rewrite from their own edit.
 */
export type SkillProvenance = 'human' | 'agent'

/**
 * One `SkillValidator` finding. `path` is the frontmatter key the
 * finding applies to (`name`, `description`, `body`, …) and is what
 * the editor matches on to place the message under the right field.
 * Entries without a `path` are surfaced in the warnings banner only.
 */
export interface SkillValidationEntry {
    code: string
    severity: 'error' | 'warning' | string
    message: string
    path?: string
}

/** GET /api/v1/custom-skills responses. */
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

/** POST /api/v1/custom-skills body. */
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
 * PUT /api/v1/custom-skills/{name} body. `name` is deliberately
 * absent — the contract rejects a rename with 422 `VALIDATION_ERROR`.
 */
export type UpdateSkillDto = Omit<CreateSkillDto, 'name'>

/** DELETE /api/v1/custom-skills/{name} body. */
export interface DeleteSkillResult {
    deleted: boolean
    name: string
    /**
     * Agents whose `allowed_skills` the delete scrubbed. Agent-level
     * only — the principal-level default is scrubbed silently. The
     * delete confirmation dialog names these BEFORE the write, because
     * deleting a skill is a multi-agent config change the operator
     * would otherwise only discover from a failing agent run.
     */
    scrubbed_agents: Array<{ id: number; name: string }>
}

/** One entry of GET /api/v1/custom-skills/{name}/allowlist. */
export interface SkillAllowlistEntry {
    id: number
    name: string
    /** `agent` = agent override, `principal` = inherited default. */
    scope: 'agent' | 'principal'
}

/** GET /api/v1/custom-skills/{name}/files/{path} body. */
export interface SkillFileContent {
    path: string
    content: string
    bytes: number
}

/**
 * Pre-shipped skills come from the HOST (`GET /api/v1/skills`), never
 * from this plugin — the frozen contract lists them under "Not
 * endpoints". These two shapes mirror `spora-frontend/src/types/skill.ts`
 * so the panes agree on field names with the host's own Skill tool UI.
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
