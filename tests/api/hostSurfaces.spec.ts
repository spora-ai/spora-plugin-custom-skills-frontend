/**
 * The routes this plugin reads but does not own: the pre-shipped catalogue,
 * per-agent `allowed_skills`, agents and principals.
 *
 * The `allowed_skills` writes have two non-obvious properties worth pinning: the
 * read needs `?raw=true` (without it the controller annotates the value and
 * `JSON.parse` throws), and every write is a read-modify-write, so a naive
 * implementation would drop the slugs already on the list.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setApi } from '../../src/api/client'
import * as preshipped from '../../src/api/preshippedSkills'
import * as allowlist from '../../src/api/agentAllowlist'
import * as agents from '../../src/api/agents'
import * as principals from '../../src/api/principals'
import type { PluginHostContext } from '../../src/shims'
import { makePreShipped } from '../fixtures'

function makeApi() {
    return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }
}

let api: ReturnType<typeof makeApi>

beforeEach(() => {
    api = makeApi()
    setApi(api as unknown as PluginHostContext['api'])
})

describe('api/preshippedSkills', () => {
    it('reads the host catalogue — never a plugin route', async () => {
        api.get.mockResolvedValueOnce({ skills: [makePreShipped()] })
        const result = await preshipped.listPreShippedSkills()
        expect(api.get).toHaveBeenCalledWith('/skills')
        expect(result).toHaveLength(1)
    })

    it('fetches one shipped skill by slug, percent-encoded', async () => {
        api.get.mockResolvedValueOnce({ skill: { name: 'a b' }, source: 'core' })
        const result = await preshipped.getPreShippedSkill('a b')
        expect(api.get).toHaveBeenCalledWith('/skills/a%20b')
        expect(result.name).toBe('a b')
    })
})

describe('api/agentAllowlist', () => {
    it('reads with ?raw=true so allowed_skills is a bare string, not {value, source}', async () => {
        api.get.mockResolvedValueOnce({ settings: { allowed_skills: '["a","b"]' } })
        const result = await allowlist.readAgentAllowedSkills(5)
        expect(api.get).toHaveBeenCalledWith('/agents/5/tools/skill/override?raw=true')
        expect(result).toEqual(['a', 'b'])
    })

    it('treats a missing or empty value as an empty allowlist', async () => {
        api.get.mockResolvedValueOnce({ settings: {} })
        expect(await allowlist.readAgentAllowedSkills(5)).toEqual([])
    })

    it('treats a hand-edited non-JSON value as an empty allowlist rather than throwing', async () => {
        api.get.mockResolvedValueOnce({ settings: { allowed_skills: 'not json' } })
        expect(await allowlist.readAgentAllowedSkills(5)).toEqual([])
    })

    it('drops non-string members of a parsed allowlist', async () => {
        api.get.mockResolvedValueOnce({ settings: { allowed_skills: '["a",7,null]' } })
        expect(await allowlist.readAgentAllowedSkills(5)).toEqual(['a'])
    })

    it('adding preserves the slugs already on the list', async () => {
        api.get.mockResolvedValueOnce({ settings: { allowed_skills: '["existing"]' } })
        api.put.mockResolvedValueOnce({})
        const next = await allowlist.addSkillsToAgentAllowlist(5, ['new-skill'])
        expect(api.put).toHaveBeenCalledWith('/agents/5/tools/skill/override', {
            settings: { allowed_skills: JSON.stringify(['existing', 'new-skill']) },
        })
        expect(next).toEqual(['existing', 'new-skill'])
    })

    it('adding a slug that is already present does not duplicate it', async () => {
        api.get.mockResolvedValueOnce({ settings: { allowed_skills: '["new-skill"]' } })
        api.put.mockResolvedValueOnce({})
        const next = await allowlist.addSkillsToAgentAllowlist(5, ['new-skill'])
        expect(next).toEqual(['new-skill'])
    })

    it('removing subtracts only the named slug', async () => {
        api.get.mockResolvedValueOnce({ settings: { allowed_skills: '["a","b","c"]' } })
        api.put.mockResolvedValueOnce({})
        const next = await allowlist.removeSkillsFromAgentAllowlist(5, ['b'])
        expect(next).toEqual(['a', 'c'])
        expect(api.put).toHaveBeenCalledWith('/agents/5/tools/skill/override', {
            settings: { allowed_skills: JSON.stringify(['a', 'c']) },
        })
    })
})

describe('api/agents + api/principals', () => {
    it('omits the principal filter when none is given', async () => {
        api.get.mockResolvedValueOnce({ agents: [] })
        await agents.listAgents(null)
        expect(api.get).toHaveBeenCalledWith('/agents', {})
    })

    it('sends principal_id as a repeatable query key', async () => {
        api.get.mockResolvedValueOnce({ agents: [] })
        await agents.listAgents([7, 8])
        expect(api.get).toHaveBeenCalledWith('/agents', { principal_id: [7, 8] })
    })

    it('accepts a bare array response as well as the { agents } envelope', async () => {
        api.get.mockResolvedValueOnce([{ id: 1, name: 'A' }])
        expect(await agents.listAgents(null)).toEqual([{ id: 1, name: 'A' }])
    })

    it('unwraps the principals envelope', async () => {
        api.get.mockResolvedValueOnce({ principals: [{ id: 7, type: 'user', name: 'U', user_id: 3, group_id: null }] })
        const result = await principals.listMyPrincipals()
        expect(api.get).toHaveBeenCalledWith('/principals/me')
        expect(result[0]?.id).toBe(7)
    })
})
