/**
 * The derivations that are easy to get subtly wrong and expensive to debug through
 * a mounted component: which validator `path` lands on which input, what "last
 * edited" means when an agent rewrote the skill, and the local mirror of the
 * server's slug rule.
 */
import { describe, it, expect } from 'vitest'
import {
    byteSize,
    clockTime,
    errorsForField,
    fieldForPath,
    forkName,
    formatBytes,
    isValidSkillName,
    lastEditedLabel,
    lineCount,
    principalScopeBlurb,
    sidecarFiles,
    skillNameConflict,
    sortByName,
    sortSkills,
    starterBody,
    unattachedErrors,
    updatedLabel,
} from '../../src/lib/skillFormat'
import { makePrincipal, makeSkill, makeValidationEntry } from '../fixtures'

describe('fieldForPath', () => {
    it('normalises the validator’s free-text paths', () => {
        expect(fieldForPath('NAME')).toBe('name')
        expect(fieldForPath('  license  ')).toBe('license')
    })

    it('returns null for a path no field claims, so it routes to the banner', () => {
        expect(fieldForPath('metadata')).toBeNull()
        // The retired field: no input claims it, so its findings go to the banner.
        expect(fieldForPath('allowed-tools')).toBeNull()
        expect(fieldForPath('')).toBeNull()
        expect(fieldForPath(undefined)).toBeNull()
        expect(fieldForPath(null)).toBeNull()
    })
})

describe('errorsForField / unattachedErrors', () => {
    const entries = [
        makeValidationEntry({ code: 'A', path: 'name' }),
        makeValidationEntry({ code: 'B', path: 'allowed-tools' }),
        makeValidationEntry({ code: 'C', severity: 'warning', path: 'body' }),
        makeValidationEntry({ code: 'D', path: 'metadata' }),
    ]

    it('returns only errors for the requested field', () => {
        expect(errorsForField(entries, 'name')).toHaveLength(1)
        expect(errorsForField(entries, 'description')).toHaveLength(0)
    })

    it('never returns a warning as a field error', () => {
        expect(errorsForField(entries, 'body')).toHaveLength(0)
    })

    it('collects the errors no field claims', () => {
        expect(unattachedErrors(entries).map((e) => e.code)).toEqual(['B', 'D'])
    })
})

describe('clockTime', () => {
    it('slices HH:MM out of the server timestamp', () => {
        expect(clockTime('2026-09-30 14:02:00')).toBe('14:02')
    })

    it('returns an empty string when the timestamp has no time part', () => {
        expect(clockTime('2026-09-30')).toBe('')
    })
})

describe('lastEditedLabel', () => {
    it('attributes an agent write to the agent', () => {
        expect(lastEditedLabel(makeSkill({ provenance: 'agent' }))).toBe('Last edited by agent · 14:02')
    })

    it('attributes a self-authored write to the operator', () => {
        expect(lastEditedLabel(makeSkill({ provenance: 'human' }))).toBe('Last edited by you · 14:02')
    })

    it('attributes a write by another user to a teammate', () => {
        const label = lastEditedLabel(makeSkill({ provenance: 'human', updated_by_user_id: 42 }))
        expect(label).toBe('Last edited by a teammate · 14:02')
    })

    it('drops the separator when there is no timestamp to show', () => {
        expect(lastEditedLabel(makeSkill({ provenance: 'agent', updated_at: '' }))).toBe('Last edited by agent')
    })
})

describe('forkName', () => {
    it('always suffixes, even when the plain name is free', () => {
        // A shipped slug is reserved server-side (409), so the copy can never
        // keep it.
        expect(forkName('code-review', new Set())).toBe('code-review-copy')
    })

    it('increments until the name is free', () => {
        const taken = new Set(['code-review-copy', 'code-review-copy-2'])
        expect(forkName('code-review', taken)).toBe('code-review-copy-3')
    })
})

describe('formatBytes', () => {
    it('renders each magnitude with a sensible unit', () => {
        expect(formatBytes(0)).toBe('0 B')
        expect(formatBytes(940)).toBe('940 B')
        expect(formatBytes(2048)).toBe('2 KB')
        expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
    })

    it('refuses to render a nonsense size', () => {
        expect(formatBytes(Number.NaN)).toBe('—')
        expect(formatBytes(-1)).toBe('—')
    })
})

describe('sidecarFiles', () => {
    it('excludes the synthesised SKILL.md entry', () => {
        expect(sidecarFiles(makeSkill()).map((f) => f.path)).toEqual(['examples/invoice.md'])
    })

    it('is empty for a skill with no sidecars', () => {
        expect(sidecarFiles(makeSkill({ files: [{ path: 'SKILL.md', bytes: 1 }] }))).toEqual([])
    })
})

describe('isValidSkillName', () => {
    // The cases are the server's `SkillValidator::NAME_PATTERN`, one for one: a
    // create form that accepts something the POST would reject is worse than no
    // local check at all.
    it('accepts lowercase alphanumerics and single inner hyphens', () => {
        expect(isValidSkillName('a')).toBe(true)
        expect(isValidSkillName('invoice-drafting')).toBe(true)
        expect(isValidSkillName('s3-bucket-2')).toBe(true)
    })

    it('rejects uppercase, spaces, underscores and slashes', () => {
        expect(isValidSkillName('Invoice-Drafting')).toBe(false)
        expect(isValidSkillName('invoice drafting')).toBe(false)
        expect(isValidSkillName('invoice_drafting')).toBe(false)
        expect(isValidSkillName('invoice/drafting')).toBe(false)
    })

    it('rejects a leading or trailing hyphen and a doubled one', () => {
        expect(isValidSkillName('-draft')).toBe(false)
        expect(isValidSkillName('draft-')).toBe(false)
        expect(isValidSkillName('in--voice')).toBe(false)
    })

    it('rejects an empty name and one past the 64-character limit', () => {
        expect(isValidSkillName('')).toBe(false)
        expect(isValidSkillName('a'.repeat(64))).toBe(true)
        expect(isValidSkillName('a'.repeat(65))).toBe(false)
    })
})

describe('skillNameConflict', () => {
    it('names the 409 the create would earn', () => {
        expect(skillNameConflict('invoice-drafting', new Set(['invoice-drafting']), new Set())).toBe('own')
        expect(skillNameConflict('code-review', new Set(), new Set(['code-review']))).toBe('shipped')
    })

    it('is null for a free name', () => {
        expect(skillNameConflict('expense-policy', new Set(['a']), new Set(['b']))).toBeNull()
    })

    it('prefers the principal’s own collision — that is the 409 you hit first', () => {
        expect(skillNameConflict('code-review', new Set(['code-review']), new Set(['code-review']))).toBe('own')
    })
})

describe('starterBody', () => {
    it('titles the outline from the slug and seeds all three headings', () => {
        const body = starterBody('invoice-drafting')
        expect(body).toContain('# Invoice drafting')
        expect(body).toContain('## When to use this')
        expect(body).toContain('## Instructions')
        expect(body).toContain('## Never')
    })

    it('leaves nothing that looks like a template placeholder', () => {
        expect(starterBody('expense-policy')).not.toContain('%')
    })
})

describe('byteSize / lineCount', () => {
    it('counts UTF-8 bytes rather than characters', () => {
        expect(byteSize('abc')).toBe(3)
        expect(byteSize('é')).toBe(2)
    })

    it('counts a single empty line as zero lines', () => {
        expect(lineCount('')).toBe(0)
        expect(lineCount('a')).toBe(1)
        expect(lineCount('a\nb')).toBe(2)
    })
})

describe('updatedLabel', () => {
    // Midnight UTC, so the assertions do not depend on the day the suite runs.
    const now = Date.UTC(2026, 8, 30, 18, 0, 0)

    it('shows the clock time for a change earlier the same day', () => {
        expect(updatedLabel('2026-09-30 14:02:00', now)).toBe('14:02')
    })

    it('shows a weekday within the week', () => {
        expect(updatedLabel('2026-09-29 14:02:00', now)).toBe('Tue')
    })

    it('shows a date beyond the week, with the year only when it differs', () => {
        expect(updatedLabel('2026-09-01 14:02:00', now)).toBe('1 Sep')
        expect(updatedLabel('2025-09-01 14:02:00', now)).toBe('1 Sep 2025')
    })

    it('degrades to the clock time rather than a negative age on clock skew', () => {
        expect(updatedLabel('2026-09-30 23:00:00', now)).toBe('23:00')
    })

    it('returns nothing for a timestamp it cannot read', () => {
        expect(updatedLabel('', now)).toBe('')
    })
})

describe('principalScopeBlurb', () => {
    it('says a user-principal’s skills are private', () => {
        expect(principalScopeBlurb(makePrincipal())).toBe(
            'Your personal skills. Only you can see and edit these.',
        )
    })

    it('separates reading from writing for a group', () => {
        const blurb = principalScopeBlurb(makePrincipal({ id: 8, type: 'group', name: 'Studio', group_id: 2 }))
        expect(blurb).toContain('Studio')
        expect(blurb).toContain('owner or an admin')
    })

    it('has no principal to describe', () => {
        expect(principalScopeBlurb(null)).toBe('No principal is selected.')
    })
})

describe('sortSkills', () => {
    const skills = [
        makeSkill({ name: 'beta', created_at: '2026-01-02 00:00:00', updated_at: '2026-03-02 00:00:00' }),
        makeSkill({ name: 'alpha', created_at: '2026-01-03 00:00:00', updated_at: '2026-03-01 00:00:00' }),
    ]

    it('defaults to most recently updated', () => {
        expect(sortSkills(skills, 'updated').map((s) => s.name)).toEqual(['beta', 'alpha'])
    })

    it('orders by creation date and by name', () => {
        expect(sortSkills(skills, 'created').map((s) => s.name)).toEqual(['alpha', 'beta'])
        expect(sortSkills(skills, 'name-asc').map((s) => s.name)).toEqual(['alpha', 'beta'])
        expect(sortSkills(skills, 'name-desc').map((s) => s.name)).toEqual(['beta', 'alpha'])
    })

    it('does not mutate the array it was given', () => {
        const input = [...skills]
        sortSkills(input, 'name-desc')
        expect(input.map((s) => s.name)).toEqual(['beta', 'alpha'])
    })
})

describe('sortByName', () => {
    it('orders the catalogue summaries', () => {
        const items = [{ name: 'zebra' }, { name: 'alpha' }]
        expect(sortByName(items, 'name-asc').map((i) => i.name)).toEqual(['alpha', 'zebra'])
        expect(sortByName(items, 'name-desc').map((i) => i.name)).toEqual(['zebra', 'alpha'])
    })
})
