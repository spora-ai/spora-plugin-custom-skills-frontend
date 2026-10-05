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
    declaredToolNames,
    declaredToolsSummary,
    errorsForField,
    fieldForPath,
    forkName,
    formatBytes,
    isValidSkillName,
    lastEditedLabel,
    lineCount,
    principalScopeBlurb,
    serializeToolNames,
    sidecarFiles,
    skillNameConflict,
    sortByName,
    sortSkills,
    starterBody,
    toolOptions,
    unattachedErrors,
    updatedLabel,
} from '../../src/lib/skillFormat'
import { makePrincipal, makeSkill, makeTool, makeTools, makeValidationEntry } from '../fixtures'

describe('fieldForPath', () => {
    it('normalises the validator’s free-text paths', () => {
        expect(fieldForPath('NAME')).toBe('name')
        expect(fieldForPath('  license  ')).toBe('license')
    })

    it('rewrites the hyphenated frontmatter key the validator reports', () => {
        // `SkillValidator` reads raw frontmatter, so its `path` is `allowed-tools`;
        // the editor's field is the underscored API name. Dropping this rewrite
        // sends every `ALLOWED_TOOLS_INVALID` to the banner and leaves the field
        // showing no error while the server refuses the save.
        expect(fieldForPath('allowed-tools')).toBe('allowed_tools')
        expect(fieldForPath('allowed_tools')).toBe('allowed_tools')
    })

    it('returns null for a path no field claims, so it routes to the banner', () => {
        expect(fieldForPath('metadata')).toBeNull()
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
        expect(errorsForField(entries, 'allowed_tools')[0]?.code).toBe('B')
    })

    it('never returns a warning as a field error', () => {
        expect(errorsForField(entries, 'body')).toHaveLength(0)
    })

    it('collects the errors no field claims', () => {
        expect(unattachedErrors(entries).map((e) => e.code)).toEqual(['D'])
    })
})

describe('declaredToolNames / serializeToolNames', () => {
    it('splits on any whitespace, because a folded scalar arrives with newlines', () => {
        // Mirrors core's `AllowedTools::entries()`, which splits on `/\s+/` and not
        // on a literal space for exactly this reason.
        expect(declaredToolNames('agent\nread_url  calendar')).toEqual(['agent', 'read_url', 'calendar'])
    })

    it('returns nothing for an absent or blank value', () => {
        expect(declaredToolNames(null)).toEqual([])
        expect(declaredToolNames(undefined)).toEqual([])
        expect(declaredToolNames('   ')).toEqual([])
    })

    it('does not judge an entry — a comma is still an entry core will report', () => {
        expect(declaredToolNames('read_email, Spora\\Tools\\ReadEmailTool')).toEqual([
            'read_email,',
            'Spora\\Tools\\ReadEmailTool',
        ])
    })

    it('joins with single spaces and keeps first-seen order', () => {
        expect(serializeToolNames(['read_url', 'agent'])).toBe('read_url agent')
        expect(serializeToolNames(['agent', 'agent'])).toBe('agent')
        expect(serializeToolNames([])).toBe('')
    })
})

describe('toolOptions', () => {
    it('offers the registry, ticking the declared names', () => {
        const rows = toolOptions(makeTools(), 'agent calendar')
        expect(rows.map((r) => r.name)).toEqual(['agent', 'calendar'])
        expect(rows.map((r) => r.selected)).toEqual([true, true])
        expect(rows.map((r) => r.available)).toEqual([true, true])
    })

    it('unions the stored names in, so a name with no tool is not dropped', () => {
        // The load-bearing property: without the union, a declared name this
        // instance cannot resolve would disappear from the group and the next save
        // would delete the declaration.
        const rows = toolOptions(makeTools(), 'read_url')
        expect(rows.map((r) => r.name)).toEqual(['agent', 'calendar', 'read_url'])
        // Appended after the registry, marked, and still selected — it is declared.
        expect(rows[2]).toMatchObject({ name: 'read_url', available: false, selected: true })
    })

    it('carries the display name and the description onto the row', () => {
        const rows = toolOptions([makeTool({ tool_name: 'x', display_name: 'Ex', description: 'Does x.' })], null)
        expect(rows[0]).toMatchObject({ label: 'Ex', description: 'Does x.' })
    })

    it('falls back to the wire name when a tool has no display name', () => {
        const rows = toolOptions([makeTool({ tool_name: 'x', display_name: null })], null)
        expect(rows[0]?.label).toBe('x')
    })

    it('marks nothing unavailable and disables nothing when the registry was not read', () => {
        // The distinction from an empty registry: `[]` says "this instance has no
        // tools", `null` says "we could not ask", and only the first may claim a
        // declared name is absent.
        const rows = toolOptions(null, 'agent read_url')
        expect(rows.map((r) => r.name)).toEqual(['agent', 'read_url'])
        expect(rows.every((r) => r.available)).toBe(true)
        // Still editable: an aid that would not load is not a reason to freeze a
        // field the author is allowed to change.
        expect(rows.every((r) => r.selected)).toBe(true)
    })
})

describe('declaredToolsSummary', () => {
    it('reports each declared name and whether this instance can resolve it', () => {
        expect(declaredToolsSummary(makeTools(), 'agent read_url')).toEqual([
            { name: 'agent', available: true },
            { name: 'read_url', available: false },
        ])
    })

    it('reports nothing as unresolved when the registry was never read', () => {
        // `null` is "could not ask", so calling a name unresolvable would be a claim
        // the failed read cannot support — and it is the one claim this surface makes.
        expect(declaredToolsSummary(null, 'agent read_url')).toEqual([
            { name: 'agent', available: true },
            { name: 'read_url', available: true },
        ])
    })

    it('reports nothing for a skill that declares nothing', () => {
        expect(declaredToolsSummary(makeTools(), null)).toEqual([])
        expect(declaredToolsSummary(makeTools(), '  ')).toEqual([])
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
