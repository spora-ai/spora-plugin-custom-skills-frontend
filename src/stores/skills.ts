import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ApiError } from '../api/client'
import * as api from '../api/customSkills'
import * as preshippedApi from '../api/preshippedSkills'
import * as allowlistApi from '../api/agentAllowlist'
import * as agentsApi from '../api/agents'
import { forkName, plural } from '../lib/skillFormat'
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
 * Manages the whole panel: the acting principal's skills (CRUD), the HOST's
 * `GET /api/v1/skills` catalogue (never mutated here), and the transient state
 * that has to outlive a single page — the delete confirmation, because a delete
 * is a multi-agent config change and its dialog is raised from a row on one page
 * and confirmed on whichever page the operator has since moved to.
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
    /**
     * Skills per principal, keyed by id, for the scope control. The contract
     * returns one principal's skills per call and has no count endpoint, so each
     * entry is a `GET /custom-skills?principal_id=N` of its own; they are cached
     * because the entry's job is to show the shape of a scope *before* choosing it.
     */
    const principalSkillCounts = ref<Record<number, number>>({})

    const loading = ref(false)
    const preShippedLoading = ref(false)
    const saving = ref(false)
    const error = ref<string | null>(null)
    const notice = ref<string | null>(null)
    const validationErrors = ref<SkillValidationEntry[]>([])

    const pendingDelete = ref<string | null>(null)
    const deleteBlastRadius = ref<string[]>([])

    function clearError(): void {
        error.value = null
        validationErrors.value = []
    }

    /** Out-of-band confirmation ("Deleted x…"), as opposed to a failure in `error`. */
    function setNotice(message: string | null): void {
        notice.value = message
    }

    async function loadSkills(): Promise<void> {
        loading.value = true
        error.value = null
        try {
            skills.value = await api.listSkills(currentPrincipalId())
            // The selected principal's own count is already in hand.
            const principalId = currentPrincipalId()
            if (principalId !== null) {
                principalSkillCounts.value = { ...principalSkillCounts.value, [principalId]: skills.value.length }
            }
        } catch (e) {
            error.value = e instanceof ApiError ? e.message : 'Failed to load skills.'
        } finally {
            loading.value = false
        }
    }

    /** Best-effort: a principal the caller cannot even read simply shows no count. */
    async function loadPrincipalSkillCount(principalId: number): Promise<void> {
        try {
            const forPrincipal = await api.listSkills(principalId)
            principalSkillCounts.value = { ...principalSkillCounts.value, [principalId]: forPrincipal.length }
        } catch {
            // 404 for a principal that is not visible, 403 for one that is not
            // writable. Either way the entry is shown without a number.
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

    /**
     * Read-then-write, in that order: the allowlist is fetched and its agents held
     * for the dialog *before* any caller is allowed to confirm. A caller that
     * skipped the read would have nothing to name.
     */
    async function requestDelete(name: string): Promise<void> {
        error.value = null
        deleteBlastRadius.value = []
        try {
            const agents = await api.getSkillAllowlist(name, currentPrincipalId())
            deleteBlastRadius.value = agents.map((a) => a.name)
        } catch {
            // The delete still proceeds; the dialog says the state is unknown
            // rather than claiming nothing is affected.
            deleteBlastRadius.value = []
        }
        pendingDelete.value = name
    }

    function cancelDelete(): void {
        pendingDelete.value = null
        deleteBlastRadius.value = []
    }

    async function confirmDelete(): Promise<string | null> {
        const name = pendingDelete.value
        if (name === null) return null
        try {
            const result = await deleteSkill(name)
            const scrubbed = result.scrubbed_agents.map((a) => a.name)
            notice.value = scrubbed.length > 0
                ? `Deleted ${result.name} and removed it from ${plural(scrubbed.length, 'agent')}: ${scrubbed.join(', ')}.`
                : `Deleted ${result.name}.`
            return result.name
        } catch {
            // `error` carries the message.
            return null
        } finally {
            cancelDelete()
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
     * Fork a shipped skill onto the acting principal. The host's
     * `SkillController::detail()` is the only read it exposes — `files` as
     * `{path, bytes}` with no per-file endpoint — so a fork copies the
     * frontmatter and the `SKILL.md` body but NOT sidecar contents. Empty
     * placeholders would overwrite the file set with blanks on the next save, so
     * the operator is told which paths to re-add.
     */
    async function duplicateShippedSkill(source: PreShippedSkillSummary): Promise<CustomSkillResource> {
        const detail = await preshippedApi.getPreShippedSkill(source.name)
        const taken = new Set(skills.value.map((s) => s.name))
        const created = await duplicateSkill(
            source,
            {
                body: detail.body,
                license: detail.license,
                compatibility: detail.compatibility,
                allowed_tools: detail.allowed_tools,
                metadata: detail.metadata,
                files: {},
            },
            forkName(source.name, taken),
        )
        const missing = detail.files.filter((f) => f.path !== 'SKILL.md')
        notice.value = missing.length > 0
            ? `Created “${created.name}” from ${source.name}. The host has no per-file read for shipped skills, so re-add ${plural(missing.length, 'sidecar file')} (${missing.map((f) => f.path).join(', ')}). It is not on any agent's allowlist yet.`
            : `Created “${created.name}” from ${source.name}. It is not on any agent's allowlist yet.`
        return created
    }

    /**
     * The name is allocated by the caller here, not by `createSkill`: it must
     * avoid the principal's skills AND the shipped catalogue, since a shipped name
     * answers 409.
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
        principalSkillCounts,
        loading,
        preShippedLoading,
        saving,
        error,
        notice,
        validationErrors,
        pendingDelete,
        deleteBlastRadius,
        skillsByName,
        clearError,
        setNotice,
        loadSkills,
        loadPreShippedSkills,
        loadPrincipalSkillCount,
        loadAgents,
        loadAllowlist,
        allowlistFor,
        requestDelete,
        cancelDelete,
        confirmDelete,
        createSkill,
        updateSkill,
        deleteSkill,
        restoreSkill,
        duplicateSkill,
        duplicateShippedSkill,
        enableOnAgent,
        disableOnAgent,
    }
})
