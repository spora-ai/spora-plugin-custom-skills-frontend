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
    /**
     * The hyphenated `allowed-tools` frontmatter value: a space-separated string of
     * bare tool names. The plugin stores it verbatim and never judges it, so an
     * untouched value round-trips byte for byte; the editor parses it only to render
     * checkboxes, and re-serialises the names when the author changes the selection.
     */
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
    /**
     * When the rollback copy was taken, and who wrote it. Null on a row saved before
     * the snapshot carried it — `has_previous` is still true in that case, which is
     * why the two are separate rather than one nullable timestamp.
     */
    previous_at: string | null
    previous_by: number | null
    warnings: SkillValidationEntry[]
    warning_count: number
}

export interface CreateSkillDto {
    name: string
    description: string
    body: string
    license?: string | null
    compatibility?: string | null
    /**
     * `allowed_tools: null` is a revocation and an absent key is "leave it alone" —
     * the desk therefore always sends the key, so both readings have to be right.
     */
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

/**
 * Mirrors the host's `SkillDetail` key for key, so this panel's read shape and
 * `spora-frontend/src/types/skill.ts` agree on field names — including
 * `allowed_tools`.
 *
 * A partial mirror was the earlier state, on the reasoning that declaring a field
 * nobody reads is an obligation with no reader. That was the wrong trade: the
 * omission *was* the divergence, and it was invisible. Declared, unread, and
 * honest beats undeclared and wrong.
 */
export interface PreShippedSkillDetail {
    name: string
    description: string
    license: string | null
    compatibility: string | null
    metadata: Record<string, string>
    /** Read by the desk for a shipped skill opened here, so its declaration shows. */
    allowed_tools: string | null
    body: string
    body_bytes: number
    files: CustomSkillFile[]
    warnings: SkillValidationEntry[]
}

/**
 * One row of the HOST's `GET /api/v1/tools` — the instance's tool registry.
 *
 * `tool_name` is the `#[Tool(name:)]` value and is the same name space a skill's
 * `allowed-tools` declares into (`Tool::NAME_REGEX`), which is the only reason
 * the desk can compare the two: a declared name is "a tool this instance has" or
 * "a tool this instance does not have", and nothing else.
 *
 * Mirrored field for field like every other shape here, though the desk reads only
 * `tool_name`, `display_name` and `description`. `ToolSchemaPresenter` documents
 * `display_name` as non-nullable and defaults it to `''`; the `| null` here is this
 * repo's own widening for a presenter that has not shipped it yet.
 */
export interface ToolSummary {
    tool_class: string
    tool_name: string
    display_name: string | null
    /**
     * The `#[Tool]` attribute's own description. Emptied by `ToolController` until
     * core copied it onto the resource, so this was structurally always `''`; the
     * editor reads it and degrades to the name alone when it is empty.
     */
    description: string
    category: string
    icon: string | null
    settings_schema: ToolSettingSchema[]
    operations: ToolOperationSchema[]
    recommends_skills: string[]
}

/** `GET /api/v1/tools → settings_schema`; the form-side schema for one tool. */
export interface ToolSettingSchema {
    key: string
    label: string
    type: string
    description: string
    default: unknown
    required: boolean
    options: Record<string, string> | string[] | null
    expose_to_llm: boolean
    data_source?: string | null
    /** `any` (default), `principal` or `agent` — where the setting is configurable. */
    scope?: string
}

/** `GET /api/v1/tools → operations`; one `#[ToolOperation]` on a multi-operation tool. */
export interface ToolOperationSchema {
    name: string
    description: string
    /** Operator-facing; falls back to the first sentence of `description`. */
    operator_description: string
    enabledByDefault: boolean
    requiresApprovalByDefault: boolean
    discriminatorKey: string
}

export interface AgentSummary {
    id: number
    name: string
}
