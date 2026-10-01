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
 * Module scope so SonarCloud's S7721 doesn't flag it inside every action; the
 * stateful binding happens through Pinia at call time.
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
 * The contract promises `data.errors`, but how the host's client decorates the
 * *error* object is its business — so probe the shapes it is known to produce and
 * degrade to `[]` rather than hard-coding one property name and rendering an
 * empty form. The operator still sees the human-readable `message`.
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
 * Manages both panes of the Custom Skills panel.
 *
 * `skills` is the acting principal's skills (CRUD); `preShipped` is the HOST's
 * `GET /api/v1/skills` and is never mutated here — the only action is
 * `duplicateSkill()`, which POSTs a copy. One store so the per-pane search and the
 * fork-name allocator see both name sets at once.
 *
 * Every write resolves `selectedPrincipalId` from `usePrincipalsStore()` at call
 * time and threads it as `?principal_id=N`, so callers cannot forget to.
 * `loading` / `saving` / `error` stay separate so a slow background read never
 * disables Save and a failed write's message survives the read after it.
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
            // A different backend surface: a host-catalogue failure must not
            // land in the shared `error` the "My skills" pane renders.
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
            // Degrades to "no agents to offer" rather than failing the page;
            // the skill itself is still editable without the control.
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
     * `scrubbed_agents` is for reporting *after* the write; the confirmation
     * dialog must already have named the blast radius from the allowlist read.
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
     * The name is allocated here, not by the caller: it must avoid the principal's
     * skills AND the shipped catalogue, since a shipped name answers 409.
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
     * Refreshes from the server so the row shows the authoritative post-write
     * state rather than an optimistic guess.
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
