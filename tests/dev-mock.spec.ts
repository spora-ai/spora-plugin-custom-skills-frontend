/**
 * The in-memory host behind `npm run dev`. It never ships in the bundle's critical
 * path, so its only risk is drift: a route shape that no longer matches the frozen
 * contract would make the dev sandbox agree with nothing. These pin the envelopes
 * the panel actually reads.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createMockApi, type MockApi } from '../src/dev-mock'

let api: MockApi

beforeEach(() => {
    api = createMockApi()
})

describe('dev-mock → envelopes the panel reads', () => {
    it('serves the principals envelope the chip row unwraps', async () => {
        const result = await api.get<{ principals: Array<{ id: number; type: string }> }>('/principals/me')
        expect(result.principals[0]?.type).toBe('user')
    })

    it('serves the host catalogue with a `source` per skill', async () => {
        const result = await api.get<{ skills: Array<{ source: string }> }>('/skills')
        expect(result.skills.length).toBeGreaterThan(0)
        expect(new Set(result.skills.map((s) => s.source)).size).toBeGreaterThan(1)
    })

    it('serves one shipped skill detail keyed by the requested slug', async () => {
        const result = await api.get<{ skill: { name: string }; source: string }>('/skills/code-review')
        expect(result.skill.name).toBe('code-review')
        expect(result.source).toBe('core')
    })

    it('percent-decodes the slug so a spaced name resolves', async () => {
        const result = await api.get<{ skill: { name: string } }>('/skills/a%20b')
        expect(result.skill.name).toBe('a b')
    })

    it('serves the custom-skills list envelope', async () => {
        const result = await api.get<{ skills: Array<{ name: string }> }>('/custom-skills')
        expect(result.skills[0]?.name).toBe('invoice-drafting')
    })

    it('honours ?principal_id= on the collection route', async () => {
        const result = await api.get<{ skills: unknown[] }>('/custom-skills?principal_id=7')
        expect(result.skills).toHaveLength(1)
    })

    it('serves an allowlist for a seeded skill and an empty one otherwise', async () => {
        const seeded = await api.get<{ agents: unknown[] }>('/custom-skills/invoice-drafting/allowlist')
        expect(seeded.agents).toHaveLength(1)
        const empty = await api.get<{ agents: unknown[] }>('/custom-skills/never-existed/allowlist')
        expect(empty.agents).toEqual([])
    })

    it('serves a sidecar read with a percent-encoded path', async () => {
        const result = await api.get<{ path: string }>('/custom-skills/invoice-drafting/files/examples%2Finvoice.md')
        expect(result.path).toBe('examples/invoice.md')
    })

    it('serves the file manifest with SKILL.md first, per the contract', async () => {
        const result = await api.get<{ files: Array<{ path: string }> }>('/custom-skills/invoice-drafting/files')
        expect(result.files[0]?.path).toBe('SKILL.md')
    })
})

describe('dev-mock → writes', () => {
    it('creating a skill makes it listable', async () => {
        const created = await api.post<{ skill: { name: string } }>('/custom-skills', {
            name: 'expense-policy',
            description: 'How to handle a claim.',
        })
        expect(created.skill.name).toBe('expense-policy')
        const list = await api.get<{ skills: Array<{ name: string }> }>('/custom-skills')
        expect(list.skills.map((s) => s.name)).toContain('expense-policy')
    })

    it('updating replaces rather than duplicates', async () => {
        await api.put('/custom-skills/invoice-drafting', { description: 'Rewritten.' })
        const list = await api.get<{ skills: Array<{ name: string; description: string }> }>('/custom-skills')
        expect(list.skills).toHaveLength(1)
        expect(list.skills[0]?.description).toBe('Rewritten.')
    })

    it('restore keeps a previous version on the restored resource', async () => {
        const restored = await api.post<{ skill: { has_previous: boolean } }>('/custom-skills/invoice-drafting/restore', {})
        expect(restored.skill.has_previous).toBe(true)
    })

    it('delete reports the agents whose allowlist it scrubbed', async () => {
        const result = await api.delete<{ deleted: boolean; name: string; scrubbed_agents: Array<{ name: string }> }>(
            '/custom-skills/invoice-drafting',
        )
        expect(result.deleted).toBe(true)
        expect(result.scrubbed_agents).toEqual([{ id: 5, name: 'Invoicer' }])
    })

    it('the allowlist override write updates the agent’s entry', async () => {
        await api.put('/agents/5/tools/skill/override', { settings: { allowed_skills: '[]' } })
        const result = await api.get<{ agents: unknown[] }>('/custom-skills/invoice-drafting/allowlist')
        expect(result.agents).toEqual([])
    })

    it('patch and an unknown route are no-ops rather than throws', async () => {
        await expect(api.patch('/anything', {})).resolves.toEqual({})
        await expect(api.get('/does/not/exist')).resolves.toBeUndefined()
    })
})

describe('dev-mock → seeding helpers', () => {
    it('seeds a skill so a two-card layout can be exercised', async () => {
        api.__seedSkill({
            id: 2, principal_id: 7, name: 'seeded', slug: 'seeded', description: '',
            license: null, compatibility: null, allowed_tools: null, metadata: {},
            body: '', body_bytes: 0, provenance: 'human',
            created_by_user_id: 3, updated_by_user_id: 3,
            created_at: '2026-09-30 10:00:00', updated_at: '2026-09-30 10:00:00',
            files: [{ path: 'SKILL.md', bytes: 0 }], has_previous: false, previous_at: null, previous_by: null,
            warnings: [], warning_count: 0,
        })
        const list = await api.get<{ skills: Array<{ name: string }> }>('/custom-skills')
        expect(list.skills.map((s) => s.name)).toContain('seeded')
    })

    it('seeds an allowlist so the delete dialog has agents to name', async () => {
        api.__seedAllowlist('other', [{ id: 9, name: 'Ops Bot', scope: 'principal' }])
        const result = await api.get<{ agents: Array<{ name: string; scope: string }> }>(
            '/custom-skills/other/allowlist',
        )
        expect(result.agents[0]).toEqual({ id: 9, name: 'Ops Bot', scope: 'principal' })
    })
})
