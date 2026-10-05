/**
 * Every field of `CustomSkillResource` is present (the frozen REST contract has no
 * optional members) so a test rendering a fixture exercises the same shape the PHP
 * serialiser emits — a partial fixture would let a typo'd field name pass.
 *
 * `makeSkill()`'s default `allowed_tools` deliberately names one tool the default
 * registry carries (`agent`) and one it does not (`read_url`), so the declared-tools
 * group is exercised in both states without a test arranging either.
 */
import type {
    CustomSkillResource,
    PreShippedSkillDetail,
    PreShippedSkillSummary,
    SkillAllowlistEntry,
    SkillValidationEntry,
    ToolSummary,
} from '../src/types'
import type { Principal } from '../src/api/principals'

/** `GET /api/v1/principals/me` — the caller's own principal first, then their groups. */
export function makePrincipal(overrides: Partial<Principal> = {}): Principal {
    return { id: 7, type: 'user', name: 'Maya Fischer', user_id: 3, group_id: null, ...overrides }
}

export function makeSkill(overrides: Partial<CustomSkillResource> = {}): CustomSkillResource {
    return {
        id: 42,
        principal_id: 7,
        name: 'invoice-drafting',
        slug: 'invoice-drafting',
        description: 'How to draft an invoice from a purchase order.',
        license: 'MIT',
        compatibility: 'spora>=0.28',
        // Space-separated bare names, per core's `AllowedTools` grammar. `read_url`
        // is deliberately absent from `makeTools()`'s default registry so a mounted
        // desk shows the unavailable row without any test having to arrange it.
        allowed_tools: 'agent read_url',
        metadata: { tier: 'pro' },
        body: '# Steps\n\n1. Read the PO.\n',
        body_bytes: 812,
        provenance: 'human',
        created_by_user_id: 3,
        updated_by_user_id: 3,
        created_at: '2026-09-30 10:00:00',
        updated_at: '2026-09-30 14:02:00',
        files: [
            { path: 'SKILL.md', bytes: 940 },
            { path: 'examples/invoice.md', bytes: 1204 },
        ],
        has_previous: true,
        previous_at: '2026-09-30 15:00:00',
        previous_by: null,
        warnings: [],
        warning_count: 0,
        ...overrides,
    }
}

export function makePreShipped(
    overrides: Partial<PreShippedSkillSummary> = {},
): PreShippedSkillSummary {
    return {
        name: 'code-review',
        description: 'House rules for reviewing a diff.',
        source: 'core',
        license: 'MIT',
        files_count: 3,
        has_warnings: false,
        ...overrides,
    }
}

export function makePreShippedDetail(
    overrides: Partial<PreShippedSkillDetail> = {},
): PreShippedSkillDetail {
    return {
        name: 'code-review',
        description: 'House rules for reviewing a diff.',
        license: 'MIT',
        compatibility: null,
        metadata: {},
        // The host sends this key on every detail response; a shipped skill that
        // declares no tools has it null. Read by the desk and the create form, so
        // a copy of this skill carries the declaration.
        allowed_tools: 'typst_compile',
        body: '# Review\n',
        body_bytes: 10,
        files: [{ path: 'SKILL.md', bytes: 10 }],
        warnings: [],
        ...overrides,
    }
}

export function makeAllowlistEntry(
    overrides: Partial<SkillAllowlistEntry> = {},
): SkillAllowlistEntry {
    return { id: 5, name: 'Invoicer', scope: 'agent', ...overrides }
}

/**
 * One row of the host's `GET /api/v1/tools`.
 *
 * Only the keys the desk reads carry values; the rest are the contract's shape,
 * present so a fixture cannot drift from the wire by omitting them.
 */
export function makeTool(overrides: Partial<ToolSummary> = {}): ToolSummary {
    return {
        tool_class: 'Spora\\Tools\\ExampleTool',
        tool_name: 'example_tool',
        display_name: 'Example tool',
        description: 'Does the example thing.',
        category: 'general',
        icon: null,
        settings_schema: [],
        operations: [],
        recommends_skills: [],
        ...overrides,
    }
}

/**
 * A registry the desk can act on: `agent` is in it, `read_url` is not, so the
 * default `makeSkill()` declaration exercises both a resolvable and an
 * unresolvable name without a test arranging either.
 */
export function makeTools(...overrides: ToolSummary[]): ToolSummary[] {
    return [
        makeTool({ tool_name: 'agent', display_name: 'Agent', description: 'Run another agent.' }),
        makeTool({
            tool_class: 'Spora\\Tools\\CalendarTool',
            tool_name: 'calendar',
            display_name: 'Calendar',
            description: '',
            category: 'productivity',
        }),
        ...overrides,
    ]
}

export function makeValidationEntry(
    overrides: Partial<SkillValidationEntry> = {},
): SkillValidationEntry {
    return {
        code: 'NAME_INVALID',
        severity: 'error',
        message: 'Name must be lowercase kebab-case.',
        path: 'name',
        ...overrides,
    }
}
