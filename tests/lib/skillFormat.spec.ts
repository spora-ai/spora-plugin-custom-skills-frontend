/**
 * Pure derivation helpers in `src/lib/skillFormat.ts`.
 *
 * These are the bits that are easy to get subtly wrong and expensive
 * to debug through a mounted component: which validator `path` lands
 * on which input, and what "last edited" means when an agent rewrote
 * the skill behind the operator's back.
 */
import { describe, it, expect } from 'vitest'
import {
    clockTime,
    errorsForField,
    fieldForPath,
    forkName,
    formatBytes,
    lastEditedLabel,
    sidecarFiles,
    unattachedErrors,
} from '../../src/lib/skillFormat'
import { makeSkill, makeValidationEntry } from '../fixtures'

describe('fieldForPath', () => {
    it('normalises the validator’s hyphenated frontmatter keys', () => {
        expect(fieldForPath('allowed-tools')).toBe('allowed_tools')
        expect(fieldForPath('allowed_tools')).toBe('allowed_tools')
        expect(fieldForPath('NAME')).toBe('name')
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
        // A shipped slug is reserved server-side (409
        // SKILL_NAME_RESERVED), so the copy can never keep it.
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
