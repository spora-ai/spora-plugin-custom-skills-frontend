import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ApiError } from '../api/client'
import * as api from '../api/customSkills'
import * as preshippedApi from '../api/preshippedSkills'
import * as allowlistApi from '../api/agentAllowlist'
import * as agentsApi from '../api/agents'
import { usePrincipalsStore } from './principals'
import type {
    AgentSummary,
    CreateSkillDto,
    CustomSkillResource,
    DeleteSkillResult,
    PreShippedSkillSummary,
    SkillAllowlistEntry,
    SkillValidationEntry,
    UpdateSkillDto,
} from '../types'

/**
 * Resolve the acting principal id lazily from the principals store.
 * Lives at module scope so SonarCloud's S7721 doesn't ask us to
 * hoist it out of every action — it's a closure-free one-liner and
 * the stateful binding happens through Pinia at call time.
 */
function currentPrincipalId(): number | null {
    return usePrincipalsStore().selectedPrincipalId
}

function isValidationEntry(value: unknown): value is SkillValidationEntry {
    if (typeof value !== 'object' || value === null) return false
    const candidate = value as Record<string, unknown>
    return typeof candidate['code'] === 'string' && typeof candidate['message'] === 'string'
}

/**
 * Pull the `ValidationResult` array out of a 422 `SKILL_INVALID`.
 *
 * The contract says the response "carries the ValidationResult array
 * in `data.errors`", but the host's api client unwraps the `{data: …}`
 * envelope on the success path and how it decorates the *error* object
 * is the host's business, not ours. Rather than hard-coding one
 * property name and rendering an empty form, probe the shapes the host
 * is known to produce and degrade to `[]` if none match — the
 * operator still sees the human-readable `message`.
 */
export function extractValidationErrors(e: unknown): SkillValidationEntry[] {
    if (Array.isArray(e)) return e.filter(isValidationEntry)
    if (typeof e !== 'object' || e === null) return []
    const root = e as Record<string, unknown>
    const candidates: unknown[] = [
        root['errors'],
        (root['data'] as Record<string, unknown> | undefined)?.['errors'],
        (root['payload'] as Record<string, unknown> | undefined)?.['errors'],
        (root['data'] as Record<string, unknown> | undefined)?.['data'] instanceof Object
            ? ((root['data'] as Record<string, unknown>)['data'] as Record<string, unknown>)['errors']
            : undefined,
    ]
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            const entries = candidate.filter(isValidationEntry)
            if (entries.length > 0) return entries
        }
    }
    return []
}

/**
 * Manages the two panes of the Custom Skills panel.
 *
 * **Two sources, one store.** `skills` is the caller's principal's
 * custom skills (CRUD, from the plugin's own REST contract).
 * `preShipped` is read from the HOST's `GET /api/v1/skills` and is
 * never mutated here — the only thing the panel can do to a shipped
 * skill is `duplicateSkill()`, which POSTs a copy onto the principal.
 * Keeping both in one store is what lets the page's per-pane search
 * and the fork-name allocator see both name sets at once.
 *
 * **Principal scoping:** every write reads `selectedPrincipalId` from
 * `usePrincipalsStore()` at call time and threads it to the API as
 * `?principal_id=N`. The `PrincipalChipRow` is the single source of
 * truth — the store doesn't take a separate principal arg, so callers
 * can't forget to forward it.
 *
 * **Loading triple:** `loading` (reads), `saving` (writes) and `error`
 * are kept separate so a slow background read never disables the Save
 * button, and so a failed write's message survives the read that
 * follows it.
 */
export const useSkillsStore = defineStore('custom-skills', () => {
    const skills = ref<CustomSkillResource[]>([])
    const preShipped = ref<PreShippedSkillSummary[]>([])
    const agents = ref<AgentSummary[]>([])
    const allowlists = ref<Record<string, SkillAllowlistEntry[]>>({})

    const loading = ref(false)
    const preShippedLoading = ref(false)
    const saving = ref(false)
    const error = ref<string | null>(null)
    const validationErrors = ref<SkillValidationEntry[]>([])

    function clearError(): void {
        error.value = null
        validationErrors.value = []
    }

    async function loadSkills(): Promise<void> {
        loading.value = true
        error.value = null
        try {
            skills.value = await api.listSkills(currentPrincipalId())
        } catch (e) {
            error.value = e instanceof ApiError ? e.message : 'Failed to load skills.'
        } finally {
            loading.value = false
        }
    }

    async function loadPreShippedSkills(): Promise<void> {
        preShippedLoading.value = true
        try {
            preShipped.value = await preshippedApi.listPreShippedSkills()
        } catch {
            // The host catalogue is a different backend surface from the
            // plugin's own; a failure there must not blank the "My
            // skills" pane's error banner, so it lands in the pane's own
            // state rather than the shared `error`.
            preShipped.value = []
        } finally {
            preShippedLoading.value = false
        }
    }

    async function loadAgents(): Promise<void> {
        const principalId = currentPrincipalId()
        try {
            agents.value = await agentsApi.listAgents(
                principalId === null ? null : [principalId],
            )
        } catch {
            // The allowlist control degrades to "no agents to offer"
            // rather than failing the page — the skill itself is still
            // editable without it.
            agents.value = []
        }
    }

    async function loadAllowlist(name: string): Promise<SkillAllowlistEntry[]> {
        const entries = await api.getSkillAllowlist(name, currentPrincipalId())
        allowlists.value = { ...allowlists.value, [name]: entries }
        return entries
    }

    function allowlistFor(name: string): SkillAllowlistEntry[] {
        return allowlists.value[name] ?? []
    }

    function upsert(skill: CustomSkillResource): void {
        const idx = skills.value.findIndex((s) => s.name === skill.name)
        if (idx === -1) {
            skills.value = [...skills.value, skill].sort((a, b) => a.name.localeCompare(b.name))
            return
        }
        const next = skills.value.slice()
        next[idx] = skill
        skills.value = next
    }

    async function createSkill(data: CreateSkillDto): Promise<CustomSkillResource> {
        saving.value = true
        error.value = null
        validationErrors.value = []
        try {
            const skill = await api.createSkill(currentPrincipalId(), data)
            upsert(skill)
            return skill
        } catch (e) {
            validationErrors.value = extractValidationErrors(e)
            error.value = e instanceof ApiError ? e.message : 'Failed to create skill.'
            throw e
        } finally {
            saving.value = false
        }
    }

    async function updateSkill(
        name: string,
        data: UpdateSkillDto,
    ): Promise<CustomSkillResource> {
        saving.value = true
        error.value = null
        validationErrors.value = []
        try {
            const skill = await api.updateSkill(name, currentPrincipalId(), data)
            upsert(skill)
            return skill
        } catch (e) {
            validationErrors.value = extractValidationErrors(e)
            error.value = e instanceof ApiError ? e.message : 'Failed to update skill.'
            throw e
        } finally {
            saving.value = false
        }
    }

    /**
     * Delete and report the blast radius. The caller is expected to
     * have already shown `DeleteSkillResult.scrubbed_agents` (fetched
     * from the allowlist endpoint) in the confirmation dialog — this
     * return value is what the page uses to tell the operator, after
     * the fact, which agents were actually scrubbed.
     */
    async function deleteSkill(name: string): Promise<DeleteSkillResult> {
        saving.value = true
        error.value = null
        validationErrors.value = []
        try {
            const result = await api.deleteSkill(name, currentPrincipalId())
            skills.value = skills.value.filter((s) => s.name !== name)
            const next = { ...allowlists.value }
            delete next[name]
            allowlists.value = next
            return result
        } catch (e) {
            error.value = e instanceof ApiError ? e.message : 'Failed to delete skill.'
            throw e
        } finally {
            saving.value = false
        }
    }

    async function restoreSkill(name: string): Promise<CustomSkillResource> {
        saving.value = true
        error.value = null
        validationErrors.value = []
        try {
            const skill = await api.restoreSkill(name, currentPrincipalId())
            upsert(skill)
            return skill
        } catch (e) {
            error.value = e instanceof ApiError ? e.message : 'Failed to restore previous version.'
            throw e
        } finally {
            saving.value = false
        }
    }

    /**
     * Fork a pre-shipped skill onto the acting principal. The name is
     * allocated here, not by the caller, because it has to avoid both
     * the principal's existing skills AND the shipped catalogue (a
     * shipped name answers 409 `SKILL_NAME_RESERVED`).
     */
    async function duplicateSkill(
        source: PreShippedSkillSummary,
        detail: {
            body: string
            license: string | null
            compatibility: string | null
            allowed_tools: string | null
            metadata: Record<string, string>
            files: Record<string, string>
        },
        name: string,
    ): Promise<CustomSkillResource> {
        return createSkill({
            name,
            description: source.description,
            body: detail.body,
            license: detail.license,
            compatibility: detail.compatibility,
            allowed_tools: detail.allowed_tools,
            metadata: detail.metadata,
            files: detail.files,
        })
    }

    /**
     * Add the skill to one agent's `allowed_skills`, then refresh the
     * card's allowlist from the server so the row reflects the
     * authoritative post-write state rather than an optimistic guess.
     */
    async function enableOnAgent(name: string, agentId: number): Promise<void> {
        saving.value = true
        error.value = null
        try {
            await allowlistApi.addSkillsToAgentAllowlist(agentId, [name])
            await loadAllowlist(name)
        } catch (e) {
            error.value = e instanceof ApiError ? e.message : 'Failed to enable the skill on this agent.'
            throw e
        } finally {
            saving.value = false
        }
    }

    /** Off-by-default: `manage_skill` operations are also approval-gated. */
    async function disableOnAgent(name: string, agentId: number): Promise<void> {
        saving.value = true
        error.value = null
        try {
            await allowlistApi.removeSkillsFromAgentAllowlist(agentId, [name])
            await loadAllowlist(name)
        } catch (e) {
            error.value = e instanceof ApiError ? e.message : 'Failed to disable the skill on this agent.'
            throw e
        } finally {
            saving.value = false
        }
    }

    const skillsByName = computed<Record<string, CustomSkillResource>>(() =>
        Object.fromEntries(skills.value.map((s) => [s.name, s])),
    )

    return {
        skills,
        preShipped,
        agents,
        allowlists,
        loading,
        preShippedLoading,
        saving,
        error,
        validationErrors,
        skillsByName,
        clearError,
        loadSkills,
        loadPreShippedSkills,
        loadAgents,
        loadAllowlist,
        allowlistFor,
        createSkill,
        updateSkill,
        deleteSkill,
        restoreSkill,
        duplicateSkill,
        enableOnAgent,
        disableOnAgent,
    }
})
