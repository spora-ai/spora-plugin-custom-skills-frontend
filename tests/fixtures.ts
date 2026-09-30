/**
 * Shared fixtures for the custom-skills specs.
 *
 * Every field of `CustomSkillResource` is present (the frozen REST
 * contract has no optional members) so a test that renders a fixture
 * is exercising the same shape the PHP serialiser emits — a partial
 * fixture would let a typo'd field name pass unnoticed.
 */
import type {
    CustomSkillResource,
    PreShippedSkillDetail,
    PreShippedSkillSummary,
    SkillAllowlistEntry,
    SkillValidationEntry,
} from '../src/types'

export function makeSkill(overrides: Partial<CustomSkillResource> = {}): CustomSkillResource {
    return {
        id: 42,
        principal_id: 7,
        name: 'invoice-drafting',
        slug: 'invoice-drafting',
        description: 'How to draft an invoice from a purchase order.',
        license: 'MIT',
        compatibility: 'spora>=0.28',
        allowed_tools: 'read_email, send_email',
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
        allowed_tools: null,
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
