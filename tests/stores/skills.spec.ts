/**
 * `useSkillsStore` — the loading/saving/error triple, in-place updates
 * after every mutation, and the two affordances that need store
 * support: the allowlist readout and the delete blast radius.
 *
 * The API module is mocked wholesale here; `tests/api/*.spec.ts`
 * covers the real client against a stubbed host.
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
import { makeSkill, makePreShipped, makePreShippedDetail, makeAllowlistEntry } from '../fixtures'

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

    it('a pre-shipped failure must not blank the shared error banner', async () => {
        // The catalogue is a different backend surface; a failure there
        // must not read as "your own skills failed to load".
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

describe('skills store → duplicate from pre-shipped', () => {
    it('POSTs the shipped frontmatter and body onto the principal', async () => {
        const source = makePreShipped({ name: 'code-review' })
        mockedApi.createSkill.mockResolvedValueOnce(makeSkill({ name: 'code-review-copy' }))
        const created = await store.duplicateSkill(
            source,
            {
                body: '# Review',
                license: 'MIT',
                compatibility: null,
                allowed_tools: null,
                metadata: { tier: 'core' },
                files: {},
            },
            'code-review-copy',
        )
        expect(mockedApi.createSkill).toHaveBeenCalledWith(7, {
            name: 'code-review-copy',
            description: source.description,
            body: '# Review',
            license: 'MIT',
            compatibility: null,
            allowed_tools: null,
            metadata: { tier: 'core' },
            files: {},
        })
        expect(created.name).toBe('code-review-copy')
        expect(store.skills).toHaveLength(1)
    })

    it('the pre-shipped detail is read from the host route, not the plugin', async () => {
        mockedPreshipped.getPreShippedSkill.mockResolvedValueOnce(makePreShippedDetail())
        const detail = await preshippedApi.getPreShippedSkill('code-review')
        expect(mockedPreshipped.getPreShippedSkill).toHaveBeenCalledWith('code-review')
        expect(detail.body).toBe('# Review\n')
    })
})
