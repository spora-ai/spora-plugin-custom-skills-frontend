/**
 * `useSkillsStore` — the loading/saving/error triple, in-place updates after every
 * mutation, and the affordances that need store support: the allowlist readout and
 * the delete blast radius. The API module is mocked wholesale here;
 * `tests/api/*.spec.ts` covers the real client.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ApiError } from '../../src/api/client'
import * as api from '../../src/api/customSkills'
import * as preshippedApi from '../../src/api/preshippedSkills'
import * as allowlistApi from '../../src/api/agentAllowlist'
import * as agentsApi from '../../src/api/agents'
import { useSkillsStore, extractValidationErrors } from '../../src/stores/skills'
import { usePrincipalsStore } from '../../src/stores/principals'
import { makeSkill, makePreShipped, makeAllowlistEntry } from '../fixtures'
import { CUSTOM_SKILLS_SOURCE } from '../../src/lib/skillFormat'

vi.mock('../../src/api/customSkills')
vi.mock('../../src/api/preshippedSkills')
vi.mock('../../src/api/agentAllowlist')
vi.mock('../../src/api/agents')
vi.mock('../../src/api/principals')

const mockedApi = vi.mocked(api)
const mockedPreshipped = vi.mocked(preshippedApi)
const mockedAllowlist = vi.mocked(allowlistApi)
const mockedAgents = vi.mocked(agentsApi)

let store: ReturnType<typeof useSkillsStore>

beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    store = useSkillsStore()
    const principals = usePrincipalsStore()
    principals.principals = [{ id: 7, type: 'user', name: 'User #7', user_id: 3, group_id: null }]
    principals.selectedPrincipalId = 7
})

describe('skills store → loading triple', () => {
    it('loads the principal’s skills and clears loading in every outcome', async () => {
        mockedApi.listSkills.mockResolvedValueOnce([makeSkill()])
        await store.loadSkills()
        expect(mockedApi.listSkills).toHaveBeenCalledWith(7)
        expect(store.skills).toHaveLength(1)
        expect(store.loading).toBe(false)
        expect(store.error).toBeNull()
    })

    it('keeps the list usable when the read fails', async () => {
        mockedApi.listSkills.mockRejectedValueOnce(new ApiError('boom', 'E', 500))
        await store.loadSkills()
        expect(store.error).toBe('boom')
        expect(store.loading).toBe(false)
    })

    it('loads the pre-shipped catalogue into its own loading flag', async () => {
        mockedPreshipped.listPreShippedSkills.mockResolvedValueOnce([makePreShipped()])
        await store.loadPreShippedSkills()
        expect(mockedPreshipped.listPreShippedSkills).toHaveBeenCalledWith()
        expect(store.preShipped).toHaveLength(1)
        expect(store.preShippedLoading).toBe(false)
    })

    it('drops this plugin’s own skills from the shipped catalogue', async () => {
        // `GET /api/v1/skills` without `?principal_id=` is the union over every
        // principal the caller can see, so it carries principal-scoped skills too.
        // `preShipped` means "shipped" wherever it is read, so they must not land
        // here — otherwise the Catalogue lists somebody's own skill as a shipped
        // global one, and the desk opens it read-only.
        mockedPreshipped.listPreShippedSkills.mockResolvedValueOnce([
            makePreShipped({ name: 'agent-creation', source: 'core' }),
            makePreShipped({ name: 'hello-world', source: CUSTOM_SKILLS_SOURCE }),
            makePreShipped({ name: 'some-plugin-skill', source: 'typst' }),
        ])
        await store.loadPreShippedSkills()
        expect(store.preShipped.map((row) => row.name)).toEqual([
            'agent-creation',
            'some-plugin-skill',
        ])
    })

    it('a pre-shipped failure must not blank the shared error banner', async () => {
        // A different backend surface: a failure there must not read as "your own
        // skills failed to load".
        mockedPreshipped.listPreShippedSkills.mockRejectedValueOnce(new ApiError('host down', 'E', 502))
        await store.loadPreShippedSkills()
        expect(store.preShipped).toEqual([])
        expect(store.error).toBeNull()
    })

    it('degrades the agent list to empty when it cannot be read', async () => {
        mockedAgents.listAgents.mockRejectedValueOnce(new ApiError('nope', 'E', 403))
        await store.loadAgents()
        expect(store.agents).toEqual([])
    })
})

describe('skills store → mutations update in place', () => {
    it('createSkill appends and keeps the list sorted by name', async () => {
        mockedApi.listSkills.mockResolvedValueOnce([makeSkill({ name: 'zebra' })])
        await store.loadSkills()
        mockedApi.createSkill.mockResolvedValueOnce(makeSkill({ name: 'alpha' }))
        await store.createSkill({
            name: 'alpha',
            description: 'a',
            body: 'b',
        })
        expect(store.skills.map((s) => s.name)).toEqual(['alpha', 'zebra'])
    })

    it('updateSkill replaces the row in place rather than appending a duplicate', async () => {
        mockedApi.listSkills.mockResolvedValueOnce([makeSkill()])
        await store.loadSkills()
        mockedApi.updateSkill.mockResolvedValueOnce(makeSkill({ description: 'Rewritten.' }))
        await store.updateSkill('invoice-drafting', { description: 'Rewritten.', body: '# Steps' })
        expect(store.skills).toHaveLength(1)
        expect(store.skills[0]?.description).toBe('Rewritten.')
    })

    it('deleteSkill drops the row and forgets its cached allowlist', async () => {
        mockedApi.listSkills.mockResolvedValueOnce([makeSkill()])
        await store.loadSkills()
        mockedApi.getSkillAllowlist.mockResolvedValueOnce([makeAllowlistEntry()])
        await store.loadAllowlist('invoice-drafting')
        expect(store.allowlistFor('invoice-drafting')).toHaveLength(1)

        mockedApi.deleteSkill.mockResolvedValueOnce({
            deleted: true,
            name: 'invoice-drafting',
            scrubbed_agents: [{ id: 5, name: 'Invoicer' }],
        })
        const result = await store.deleteSkill('invoice-drafting')
        expect(store.skills).toHaveLength(0)
        expect(store.allowlistFor('invoice-drafting')).toEqual([])
        expect(result.scrubbed_agents).toEqual([{ id: 5, name: 'Invoicer' }])
    })

    it('restoreSkill writes the restored resource back over the row', async () => {
        mockedApi.listSkills.mockResolvedValueOnce([makeSkill()])
        await store.loadSkills()
        mockedApi.restoreSkill.mockResolvedValueOnce(makeSkill({ has_previous: false, body: '# Old' }))
        const restored = await store.restoreSkill('invoice-drafting')
        expect(store.skills[0]?.has_previous).toBe(false)
        expect(store.skills[0]?.body).toBe('# Old')
        expect(restored.has_previous).toBe(false)
    })

    it('a failed write leaves the row list untouched and re-throws', async () => {
        mockedApi.listSkills.mockResolvedValueOnce([makeSkill()])
        await store.loadSkills()
        mockedApi.updateSkill.mockRejectedValueOnce(new ApiError('nope', 'E', 403))
        await expect(store.updateSkill('invoice-drafting', { description: '', body: '' })).rejects.toThrow('nope')
        expect(store.skills).toHaveLength(1)
        expect(store.saving).toBe(false)
        expect(store.error).toBe('nope')
    })
})

describe('skills store → validation feedback', () => {
    it('captures the ValidationResult array from a 422 SKILL_INVALID', async () => {
        const err = Object.assign(new ApiError('Skill is invalid.', 'SKILL_INVALID', 422), {
            data: {
                errors: [
                    { code: 'NAME_INVALID', severity: 'error', message: 'lowercase kebab-case only', path: 'name' },
                ],
            },
        })
        mockedApi.createSkill.mockRejectedValueOnce(err)
        await expect(store.createSkill({ name: 'Bad Name', description: '', body: '' })).rejects.toThrow()
        expect(store.validationErrors).toEqual([
            { code: 'NAME_INVALID', severity: 'error', message: 'lowercase kebab-case only', path: 'name' },
        ])
    })

    it('clears stale validation findings on the next successful write', async () => {
        store.validationErrors = [{ code: 'X', severity: 'error', message: 'old', path: 'name' }]
        mockedApi.createSkill.mockResolvedValueOnce(makeSkill())
        await store.createSkill({ name: 'ok', description: '', body: '' })
        expect(store.validationErrors).toEqual([])
    })

    it('clearError() resets both the message and the findings', () => {
        store.error = 'boom'
        store.validationErrors = [{ code: 'X', severity: 'error', message: 'm' }]
        store.clearError()
        expect(store.error).toBeNull()
        expect(store.validationErrors).toEqual([])
    })

    it('extractValidationErrors probes the shapes the host can produce', () => {
        const entry = { code: 'A', severity: 'error', message: 'm', path: 'body' }
        expect(extractValidationErrors({ data: { errors: [entry] } })).toEqual([entry])
        expect(extractValidationErrors({ payload: { errors: [entry] } })).toEqual([entry])
        expect(extractValidationErrors([entry])).toEqual([entry])
        expect(extractValidationErrors(new Error('plain'))).toEqual([])
        expect(extractValidationErrors({ data: { errors: [{ nope: true }] } })).toEqual([])
    })
})

describe('skills store → allowlist affordance', () => {
    it('caches the allowlist per skill so the card can render it', async () => {
        mockedApi.getSkillAllowlist.mockResolvedValueOnce([makeAllowlistEntry()])
        await store.loadAllowlist('invoice-drafting')
        expect(mockedApi.getSkillAllowlist).toHaveBeenCalledWith('invoice-drafting', 7)
        expect(store.allowlistFor('invoice-drafting')).toHaveLength(1)
        expect(store.allowlists['invoice-drafting']).toHaveLength(1)
    })

    it('an unloaded skill reports an empty allowlist, not undefined', () => {
        expect(store.allowlistFor('never-loaded')).toEqual([])
    })

    it('enableOnAgent writes the allowlist then refreshes from the server', async () => {
        mockedAllowlist.addSkillsToAgentAllowlist.mockResolvedValueOnce(['invoice-drafting'])
        mockedApi.getSkillAllowlist.mockResolvedValueOnce([makeAllowlistEntry()])
        await store.enableOnAgent('invoice-drafting', 5)
        expect(mockedAllowlist.addSkillsToAgentAllowlist).toHaveBeenCalledWith(5, ['invoice-drafting'])
        expect(mockedApi.getSkillAllowlist).toHaveBeenCalledWith('invoice-drafting', 7)
    })

    it('disableOnAgent subtracts the slug', async () => {
        mockedAllowlist.removeSkillsFromAgentAllowlist.mockResolvedValueOnce([])
        mockedApi.getSkillAllowlist.mockResolvedValueOnce([])
        await store.disableOnAgent('invoice-drafting', 5)
        expect(mockedAllowlist.removeSkillsFromAgentAllowlist).toHaveBeenCalledWith(5, ['invoice-drafting'])
    })

    it('a failed enable surfaces the message and leaves saving false', async () => {
        mockedAllowlist.addSkillsToAgentAllowlist.mockRejectedValueOnce(new ApiError('read-only agent', 'E', 403))
        await expect(store.enableOnAgent('invoice-drafting', 5)).rejects.toThrow('read-only agent')
        expect(store.error).toBe('read-only agent')
        expect(store.saving).toBe(false)
    })
})

describe('skills store → the delete confirmation is read-then-write', () => {
    it('reads the allowlist before anything can confirm, and names the agents', async () => {
        mockedApi.listSkills.mockResolvedValueOnce([makeSkill()])
        await store.loadSkills()

        const order: string[] = []
        mockedApi.getSkillAllowlist.mockImplementation(async () => {
            order.push('allowlist-read')
            return [makeAllowlistEntry({ id: 5, name: 'Invoicer' })]
        })
        mockedApi.deleteSkill.mockImplementation(async () => {
            order.push('delete')
            return { deleted: true, name: 'invoice-drafting', scrubbed_agents: [] }
        })

        await store.requestDelete('invoice-drafting')
        // Raising the confirmation must not have written: the dialog still has to be
        // read before the operator decides.
        expect(order).toEqual(['allowlist-read'])
        expect(store.pendingDelete).toBe('invoice-drafting')
        expect(store.deleteBlastRadius).toEqual(['Invoicer'])

        await store.confirmDelete()
        expect(order).toEqual(['allowlist-read', 'delete'])
    })

    it('still allows the delete when the allowlist read fails, saying nothing about it', async () => {
        // A dialog that refuses to open because a preview read failed would leave the
        // operator unable to delete at all.
        mockedApi.getSkillAllowlist.mockRejectedValueOnce(new ApiError('nope', 'E', 500))
        await store.requestDelete('invoice-drafting')
        expect(store.pendingDelete).toBe('invoice-drafting')
        expect(store.deleteBlastRadius).toEqual([])
    })

    it('reports the scrubbed agents and returns the deleted name for the caller to navigate from', async () => {
        mockedApi.listSkills.mockResolvedValueOnce([makeSkill()])
        await store.loadSkills()
        mockedApi.getSkillAllowlist.mockResolvedValueOnce([makeAllowlistEntry({ id: 5, name: 'Invoicer' })])
        mockedApi.deleteSkill.mockResolvedValueOnce({
            deleted: true,
            name: 'invoice-drafting',
            scrubbed_agents: [{ id: 5, name: 'Invoicer' }],
        })

        await store.requestDelete('invoice-drafting')
        expect(await store.confirmDelete()).toBe('invoice-drafting')
        expect(store.notice).toBe('Deleted invoice-drafting and removed it from 1 agent: Invoicer.')
        expect(store.skills).toHaveLength(0)
    })

    it('cancelling issues no write and clears the dialog', async () => {
        mockedApi.getSkillAllowlist.mockResolvedValueOnce([makeAllowlistEntry()])
        await store.requestDelete('invoice-drafting')
        store.cancelDelete()
        expect(store.pendingDelete).toBeNull()
        expect(store.deleteBlastRadius).toEqual([])
        expect(mockedApi.deleteSkill).not.toHaveBeenCalled()
    })

    it('confirming with nothing pending is a no-op', async () => {
        expect(await store.confirmDelete()).toBeNull()
        expect(mockedApi.deleteSkill).not.toHaveBeenCalled()
    })

    it('a failed delete keeps the row and clears the dialog', async () => {
        mockedApi.listSkills.mockResolvedValueOnce([makeSkill()])
        await store.loadSkills()
        mockedApi.getSkillAllowlist.mockResolvedValueOnce([])
        mockedApi.deleteSkill.mockRejectedValueOnce(new ApiError('403', 'FORBIDDEN', 403))

        await store.requestDelete('invoice-drafting')
        expect(await store.confirmDelete()).toBeNull()
        expect(store.skills).toHaveLength(1)
        expect(store.pendingDelete).toBeNull()
        expect(store.error).toBe('403')
    })
})

describe('skills store → per-principal counts for the scope control', () => {
    it('caches the selected principal’s own count as a side effect of the list read', async () => {
        mockedApi.listSkills.mockResolvedValueOnce([makeSkill(), makeSkill({ name: 'b' })])
        await store.loadSkills()
        expect(store.principalSkillCounts[7]).toBe(2)
    })

    it('reads a count for another principal without disturbing the loaded list', async () => {
        mockedApi.listSkills.mockResolvedValueOnce([makeSkill()])
        await store.loadSkills()
        mockedApi.listSkills.mockResolvedValueOnce([makeSkill(), makeSkill({ name: 'b' }), makeSkill({ name: 'c' })])

        await store.loadPrincipalSkillCount(8)
        expect(store.principalSkillCounts[8]).toBe(3)
        // The loaded list is the selected principal's; a count for another one must
        // not overwrite it.
        expect(store.skills).toHaveLength(1)
    })

    it('leaves a principal with no count when it cannot be read', async () => {
        mockedApi.listSkills.mockRejectedValueOnce(new ApiError('404', 'SKILL_NOT_FOUND', 404))
        await store.loadPrincipalSkillCount(8)
        expect(store.principalSkillCounts[8]).toBeUndefined()
    })

    it('forgets a deleted skill’s count contribution by re-reading the list', async () => {
        mockedApi.listSkills.mockResolvedValueOnce([makeSkill(), makeSkill({ name: 'b' })])
        await store.loadSkills()
        mockedApi.deleteSkill.mockResolvedValueOnce({
            deleted: true,
            name: 'invoice-drafting',
            scrubbed_agents: [],
        })
        await store.deleteSkill('invoice-drafting')
        mockedApi.listSkills.mockResolvedValueOnce([makeSkill({ name: 'b' })])
        await store.loadSkills()
        expect(store.principalSkillCounts[7]).toBe(1)
    })
})

describe('skills store → the notice', () => {
    it('is separate from error, and clearable', () => {
        store.error = 'Failed to save.'
        store.setNotice('Deleted x.')
        expect(store.notice).toBe('Deleted x.')
        expect(store.error).toBe('Failed to save.')
        store.setNotice(null)
        expect(store.notice).toBeNull()
    })
})

describe('skills store → creating from a shipped skill', () => {
    it('has no duplicate of its own: the create form is the only path in', async () => {
        // The store used to expose `duplicateShippedSkill`, which POSTed a copy
        // itself. Three buttons called it, and it wrote a row before the operator
        // had named it — the name being final, that copy then had to be deleted.
        // Duplicating is now a navigation to `/new?template=`, and `createSkill` is
        // the single write. Nothing here should reintroduce a second one.
        expect('duplicateShippedSkill' in store).toBe(false)
        expect('duplicateSkill' in store).toBe(false)
    })

    it('createSkill takes the shipped frontmatter verbatim when the form supplies it', async () => {
        // The form builds the DTO from the template; the store must not reshape it.
        mockedApi.createSkill.mockResolvedValueOnce(makeSkill({ name: 'code-review-copy' }))
        await store.createSkill({
            name: 'code-review-copy',
            description: 'Reviews code.',
            body: '# Review\n',
            license: 'MIT',
            compatibility: null,
            allowed_tools: null,
            metadata: { tier: 'core' },
            files: {},
        })
        expect(mockedApi.createSkill).toHaveBeenCalledWith(7, {
            name: 'code-review-copy',
            description: 'Reviews code.',
            body: '# Review\n',
            license: 'MIT',
            compatibility: null,
            allowed_tools: null,
            metadata: { tier: 'core' },
            files: {},
        })
        expect(store.skills).toHaveLength(1)
    })
})
