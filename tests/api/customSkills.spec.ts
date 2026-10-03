/**
 * Every exported function in `src/api/customSkills.ts` against a stubbed host API.
 * The store spec mocks the API module wholesale, so its real implementation never
 * runs there.
 *
 * The path assertions are the load-bearing part: `?principal_id=` is threaded by
 * hand (the host client takes a `query` object for GET but not the write verbs),
 * and the sidecar `{path}` has to be percent-encoded with its slashes intact for
 * Symfony to route it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setApi, ApiError } from '../../src/api/client'
import * as skills from '../../src/api/customSkills'
import type { PluginHostContext } from '../../src/shims'
import { makeSkill } from '../fixtures'

function makeApi() {
    return {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
    }
}

let api: ReturnType<typeof makeApi>

beforeEach(() => {
    api = makeApi()
    setApi(api as unknown as PluginHostContext['api'])
})

describe('api/customSkills → reads', () => {
    it('listSkills unwraps the { skills: T[] } envelope', async () => {
        api.get.mockResolvedValueOnce({ skills: [{ name: 'a' }] })
        const result = await skills.listSkills(null)
        expect(api.get).toHaveBeenCalledWith('/custom-skills')
        expect(result).toEqual([{ name: 'a' }])
    })

    it('listSkills omits principal_id for the caller’s own principal', async () => {
        api.get.mockResolvedValueOnce({ skills: [] })
        await skills.listSkills(null)
        expect(api.get).toHaveBeenCalledWith('/custom-skills')
    })

    it('listSkills appends ?principal_id=N when a group is selected', async () => {
        api.get.mockResolvedValueOnce({ skills: [] })
        await skills.listSkills(99)
        expect(api.get).toHaveBeenCalledWith('/custom-skills?principal_id=99')
    })

    it('getSkill unwraps the { skill: T } envelope and percent-encodes the slug', async () => {
        api.get.mockResolvedValueOnce({ skill: { name: 'a b' } })
        const result = await skills.getSkill('a b', null)
        expect(api.get).toHaveBeenCalledWith('/custom-skills/a%20b')
        expect(result).toEqual({ name: 'a b' })
    })

    it('getSkill threads principal_id onto the read', async () => {
        api.get.mockResolvedValueOnce({ skill: { name: 'a' } })
        await skills.getSkill('a', 99)
        expect(api.get).toHaveBeenCalledWith('/custom-skills/a?principal_id=99')
    })

    it('listSkillFiles unwraps { files: T[] }', async () => {
        api.get.mockResolvedValueOnce({ files: [{ path: 'SKILL.md', bytes: 1 }] })
        const result = await skills.listSkillFiles('a', null)
        expect(api.get).toHaveBeenCalledWith('/custom-skills/a/files')
        expect(result).toEqual([{ path: 'SKILL.md', bytes: 1 }])
    })

    it('getSkillFile percent-encodes the whole sidecar path, slashes included', async () => {
        api.get.mockResolvedValueOnce({ path: 'examples/invoice.md', content: 'x', bytes: 1 })
        const result = await skills.getSkillFile('a', 'examples/invoice.md', null)
        // The contract: `{path}` matches the REST of the path, percent-encoded by
        // the client — `examples%2Finvoice.md`.
        expect(api.get).toHaveBeenCalledWith('/custom-skills/a/files/examples%2Finvoice.md')
        expect(result.content).toBe('x')
    })

    it('getSkillFile threads principal_id', async () => {
        api.get.mockResolvedValueOnce({ path: 'a.md', content: '', bytes: 0 })
        await skills.getSkillFile('a', 'a.md', 99)
        expect(api.get).toHaveBeenCalledWith('/custom-skills/a/files/a.md?principal_id=99')
    })

    it('getSkillAllowlist unwraps { agents: T[] }', async () => {
        api.get.mockResolvedValueOnce({ agents: [{ id: 5, name: 'Invoicer', scope: 'agent' }] })
        const result = await skills.getSkillAllowlist('a', 99)
        expect(api.get).toHaveBeenCalledWith('/custom-skills/a/allowlist?principal_id=99')
        expect(result).toEqual([{ id: 5, name: 'Invoicer', scope: 'agent' }])
    })
})

describe('api/customSkills → writes', () => {
    const dto = {
        name: 'invoice-drafting',
        description: 'How to draft an invoice.',
        body: '# Steps',
        license: 'MIT',
        compatibility: null,
        metadata: { tier: 'pro' },
        files: { 'examples/invoice.md': 'x' },
    }

    it('createSkill POSTs to /custom-skills and unwraps { skill: T }', async () => {
        api.post.mockResolvedValueOnce({ skill: makeSkill() })
        const result = await skills.createSkill(null, dto)
        expect(api.post).toHaveBeenCalledWith('/custom-skills', dto)
        expect(result.name).toBe('invoice-drafting')
    })

    it('createSkill appends ?principal_id=N to the collection', async () => {
        api.post.mockResolvedValueOnce({ skill: makeSkill() })
        await skills.createSkill(99, dto)
        expect(api.post).toHaveBeenCalledWith('/custom-skills?principal_id=99', dto)
    })

    it('updateSkill PUTs to /custom-skills/{name} without a name in the body', async () => {
        api.put.mockResolvedValueOnce({ skill: makeSkill() })
        // `name` is excluded because the contract rejects a rename with 422. Both
        // assertions are load-bearing: the URL, and that no `name` rode along.
        const { name, ...update } = dto
        expect(name).toBe('invoice-drafting')
        await skills.updateSkill('invoice-drafting', 99, update)
        expect(api.put).toHaveBeenCalledWith('/custom-skills/invoice-drafting?principal_id=99', update)
        expect(api.put.mock.calls[0]?.[1]).not.toHaveProperty('name')
    })

    it('deleteSkill returns the scrubbed agents so the UI can report them', async () => {
        api.delete.mockResolvedValueOnce({
            deleted: true,
            name: 'invoice-drafting',
            scrubbed_agents: [{ id: 5, name: 'Invoicer' }],
        })
        const result = await skills.deleteSkill('invoice-drafting', null)
        expect(api.delete).toHaveBeenCalledWith('/custom-skills/invoice-drafting')
        expect(result.scrubbed_agents).toEqual([{ id: 5, name: 'Invoicer' }])
    })

    it('restoreSkill POSTs to the restore route and unwraps { skill: T }', async () => {
        api.post.mockResolvedValueOnce({ skill: makeSkill({ has_previous: false }) })
        const result = await skills.restoreSkill('invoice-drafting', 99)
        expect(api.post).toHaveBeenCalledWith('/custom-skills/invoice-drafting/restore?principal_id=99', {})
        expect(result.has_previous).toBe(false)
    })

    it('forkSkill is a plain create — the contract has no fork endpoint', async () => {
        api.post.mockResolvedValueOnce({ skill: makeSkill({ name: 'code-review-copy' }) })
        await skills.forkSkill(null, { ...dto, name: 'code-review-copy' })
        expect(api.post).toHaveBeenCalledWith('/custom-skills', expect.objectContaining({ name: 'code-review-copy' }))
    })
})

describe('api/client → error surface', () => {
    it('ApiError carries message, code and status for the store to surface', () => {
        const e = new ApiError('Skill name is taken.', 'SKILL_NAME_TAKEN', 409)
        expect(e).toBeInstanceOf(Error)
        expect(e.message).toBe('Skill name is taken.')
        expect(e.code).toBe('SKILL_NAME_TAKEN')
        expect(e.status).toBe(409)
    })
})
