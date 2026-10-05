/**
 * In-memory host for `npm run dev`, stubbing both the plugin's REST contract and
 * the host's `GET /api/v1/skills`.
 *
 * Implements the *shapes* from the frozen contract, not the validation: a mock
 * that validated would hide the 422 `ValidationResult` case, which is the
 * interesting one. Kept out of `dev-main.ts` so the bootstrap stays testable.
 */
import type { PluginHostContext } from './shims'
import type {
    CustomSkillResource,
    PreShippedSkillSummary,
    SkillAllowlistEntry,
    ToolSummary,
} from './types'

const SKILL_ENTRY_FILE = 'SKILL.md'

function makeSkill(overrides: Partial<CustomSkillResource> & { name: string }): CustomSkillResource {
    return {
        id: 1,
        principal_id: 7,
        slug: overrides.name,
        description: '',
        license: null,
        compatibility: null,
        allowed_tools: null,
        metadata: {},
        body: '',
        body_bytes: 0,
        provenance: 'human',
        created_by_user_id: 3,
        updated_by_user_id: 3,
        created_at: '2026-09-30 10:00:00',
        updated_at: '2026-09-30 14:02:00',
        files: [{ path: SKILL_ENTRY_FILE, bytes: 0 }],
        has_previous: false,
        previous_at: null,
        previous_by: null,
        warnings: [],
        warning_count: 0,
        ...overrides,
    }
}

const SEED_SKILL = makeSkill({
    name: 'invoice-drafting',
    description: 'How to draft an invoice from a purchase order.',
    // One resolvable and one not, so the unavailable row is reachable in the dev
    // sandbox and not only in a test that fabricates a registry.
    allowed_tools: 'agent read_url legacy_erp_export',
    body: '# Steps\n\n1. Read the PO.\n2. Draft the invoice.\n',
    provenance: 'agent',
    has_previous: true,
    warning_count: 1,
    warnings: [
        {
            code: 'BODY_SOFT_BYTE_LIMIT',
            severity: 'warning',
            message: 'Body is above the soft byte limit.',
            path: 'body',
        },
    ],
    files: [
        { path: SKILL_ENTRY_FILE, bytes: 940 },
        { path: 'examples/invoice.md', bytes: 1204 },
    ],
})

const SEED_ALLOWLISTS: Record<string, SkillAllowlistEntry[]> = {
    'invoice-drafting': [{ id: 5, name: 'Invoicer', scope: 'agent' }],
}

const SEED_PRE_SHIPPED: PreShippedSkillSummary[] = [
    { name: 'code-review', description: 'House rules for reviewing a diff.', source: 'core', license: 'MIT', files_count: 3, has_warnings: false },
    { name: 'release-notes', description: 'Changelog voice and format.', source: 'core', license: 'MIT', files_count: 1, has_warnings: true },
    { name: 'brand-voice', description: 'Product copy voice guide.', source: 'marketing', license: null, files_count: 2, has_warnings: false },
]

const MOCK_AGENTS = [
    { id: 5, name: 'Invoicer' },
    { id: 6, name: 'Researcher' },
]

/**
 * The host's `GET /api/v1/tools`, so the desk's checkbox group has something to
 * render in the dev sandbox. Only the three keys the desk reads are filled — the
 * rest are structural noise for this screen and a mock that invented settings rows
 * would be testing fiction.
 */
const MOCK_TOOLS: ToolSummary[] = [
    {
        tool_class: String.raw`Spora\Tools\AgentTool`,
        tool_name: 'agent',
        display_name: 'Agent',
        description: 'Run another agent on this principal and return what it reports.',
        category: 'general',
        icon: null,
        settings_schema: [],
        operations: [],
        recommends_skills: [],
    },
    {
        tool_class: String.raw`Spora\Tools\ReadUrlTool`,
        tool_name: 'read_url',
        display_name: 'Read URL',
        description: 'Fetch a URL and return its readable text.',
        category: 'web',
        icon: null,
        settings_schema: [],
        operations: [],
        recommends_skills: [],
    },
    {
        tool_class: String.raw`Spora\Tools\CalendarTool`,
        tool_name: 'calendar',
        display_name: 'Calendar',
        description: '',
        category: 'productivity',
        icon: null,
        settings_schema: [],
        operations: [],
        recommends_skills: [],
    },
]

const MOCK_PRINCIPALS = [
    { id: 7, type: 'user', name: 'User #7', user_id: 3, group_id: null },
    { id: 8, type: 'group', name: 'Ops', user_id: null, group_id: 2 },
]

/**
 * `__seed*` helpers let the sandbox and its spec build an "N agents allowlist this
 * skill" state without a backend.
 */
export type MockApi = PluginHostContext['api'] & {
    __seedAllowlist(name: string, entries: SkillAllowlistEntry[]): void
    __seedSkill(skill: CustomSkillResource): void
}

export function createMockApi(): MockApi {
    const skills: CustomSkillResource[] = [SEED_SKILL]
    const allowlists: Record<string, SkillAllowlistEntry[]> = {
        'invoice-drafting': [...(SEED_ALLOWLISTS['invoice-drafting'] ?? [])],
    }

    function upsert(skill: CustomSkillResource): void {
        const idx = skills.findIndex((s) => s.name === skill.name)
        if (idx === -1) skills.push(skill)
        else skills[idx] = skill
    }

    return {
        async get<T = unknown>(path: string): Promise<T> {
            if (path === '/principals/me') return { principals: MOCK_PRINCIPALS } as unknown as T
            if (path === '/agents') return { agents: MOCK_AGENTS } as unknown as T
            if (path === '/tools') return { tools: MOCK_TOOLS } as unknown as T
            if (path === '/skills') return { skills: SEED_PRE_SHIPPED } as unknown as T
            if (path.startsWith('/skills/')) {
                const name = decodeURIComponent(path.slice('/skills/'.length).split('?')[0] ?? '')
                const summary = SEED_PRE_SHIPPED.find((s) => s.name === name)
                return {
                    skill: {
                        name,
                        description: summary?.description ?? '',
                        license: summary?.license ?? null,
                        compatibility: null,
                        metadata: {},
                        // Host sends this on every detail response; null when the
                        // skill declares no tools. Carried into the desk so a
                        // shipped skill's declaration is on screen here, but a mock
                        // that omits it hides the very drift this type exists to
                        // prevent.
                        allowed_tools: null,
                        body: `# ${name}\n\nShipped body.\n`,
                        body_bytes: 24,
                        files: [{ path: SKILL_ENTRY_FILE, bytes: 24 }],
                        warnings: [],
                    },
                    source: summary?.source ?? 'core',
                } as unknown as T
            }
            if (path.includes('/tools/skill/override')) {
                return { settings: { allowed_skills: '["invoice-drafting"]' } } as unknown as T
            }
            if (path === '/custom-skills' || path.startsWith('/custom-skills?')) {
                return { skills } as unknown as T
            }
            const allowlistMatch = /^\/custom-skills\/([^/?]+)\/allowlist/.exec(path)
            if (allowlistMatch) {
                const name = decodeURIComponent(allowlistMatch[1] as string)
                return { agents: allowlists[name] ?? [] } as unknown as T
            }
            const fileMatch = /^\/custom-skills\/([^/?]+)\/files\/(.+)$/.exec(path)
            if (fileMatch) {
                return { path: decodeURIComponent(fileMatch[2] as string), content: '', bytes: 0 } as unknown as T
            }
            if (/\/custom-skills\/([^/?]+)\/files/.test(path)) {
                const name = decodeURIComponent(path.split('?')[0]?.split('/')[2] ?? '')
                return { files: skills.find((s) => s.name === name)?.files ?? [] } as unknown as T
            }
            const singleMatch = /^\/custom-skills\/([^/?]+)/.exec(path)
            if (singleMatch) {
                const name = decodeURIComponent(singleMatch[1] as string)
                return { skill: skills.find((s) => s.name === name) ?? makeSkill({ name }) } as unknown as T
            }
            return undefined as unknown as T
        },

        async post<T = unknown>(path: string, body: unknown): Promise<T> {
            if (path.includes('/restore')) {
                const name = decodeURIComponent(path.split('?')[0]?.split('/')[2] ?? '')
                const current = skills.find((s) => s.name === name) ?? makeSkill({ name })
                const restored = {
                    ...current,
                    has_previous: true,
                    previous_at: current.updated_at,
                    previous_by: null,
                    updated_at: '2026-09-30 15:00:00',
                }
                upsert(restored)
                return { skill: restored } as unknown as T
            }
            const payload = (body ?? {}) as Partial<CustomSkillResource> & { name?: string }
            const name = payload.name ?? 'skill'
            const skill = makeSkill({
                name,
                slug: name,
                description: payload.description ?? '',
                body: payload.body ?? '',
            })
            upsert(skill)
            return { skill } as unknown as T
        },

        async put<T = unknown>(path: string, body: unknown): Promise<T> {
            if (path.includes('/tools/skill/override')) {
                const agentId = Number(path.split('/')[2])
                const settings = (body as { settings?: Record<string, string> }).settings ?? {}
                const slug = JSON.parse(settings['allowed_skills'] ?? '[]') as string[]
                for (const [name, entries] of Object.entries(allowlists)) {
                    allowlists[name] = entries.filter((e) => e.id !== agentId || slug.includes(name))
                }
                return {} as unknown as T
            }
            const name = decodeURIComponent(path.split('?')[0]?.split('/')[2] ?? '')
            const payload = (body ?? {}) as Partial<CustomSkillResource>
            const skill = makeSkill({ ...payload, name, slug: name })
            upsert(skill)
            return { skill } as unknown as T
        },

        async patch<T = unknown>(): Promise<T> {
            return {} as unknown as T
        },

        async delete<T = unknown>(path: string): Promise<T> {
            const name = decodeURIComponent(path.split('?')[0]?.split('/')[2] ?? '')
            const scrubbed = allowlists[name] ?? []
            const idx = skills.findIndex((s) => s.name === name)
            if (idx !== -1) skills.splice(idx, 1)
            delete allowlists[name]
            return {
                deleted: true,
                name,
                scrubbed_agents: scrubbed.map((a) => ({ id: a.id, name: a.name })),
            } as unknown as T
        },

        __seedAllowlist(name: string, entries: SkillAllowlistEntry[]) {
            allowlists[name] = entries
        },
        __seedSkill(skill: CustomSkillResource) {
            upsert(skill)
        },
    }
}
