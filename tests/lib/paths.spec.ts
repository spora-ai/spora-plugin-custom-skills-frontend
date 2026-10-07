/**
 * Every path the panel navigates to.
 *
 * Not helper tests: each `principalId: number | null` parameter *is* the enforcement
 * mechanism, and the `null` cases are what the unscoped legacy routes use.
 */
import { describe, it, expect } from 'vitest'
import {
    deskPath,
    homePath,
    libraryPath,
    newSkillPath,
    viewerPath,
} from '../../src/lib/paths'

describe('homePath', () => {
    it('scopes home to the acting principal', () => {
        expect(homePath(7)).toBe('/p/7')
    })

    it('is the bare root with no principal, which means the default', () => {
        expect(homePath(null)).toBe('/')
    })
})

describe('newSkillPath', () => {
    it('carries the principal, because the create writes to it', () => {

        expect(newSkillPath(8)).toBe('/p/8/new')
    })

    it('is top-level unscoped, so it cannot shadow a skill named "new"', () => {

        expect(newSkillPath(null)).toBe('/new')
    })
})

describe('deskPath', () => {
    it('names both the principal and the skill', () => {
        expect(deskPath(8, 'invoice-drafting')).toBe('/p/8/skill/invoice-drafting')
    })

    it('is unscoped with no principal — the legacy `/skill/{name}` shape', () => {
        expect(deskPath(null, 'invoice-drafting')).toBe('/skill/invoice-drafting')
    })

    it('encodes a name that would otherwise forge a different path', () => {

        expect(deskPath(8, 'a/b')).toBe('/p/8/skill/a%2Fb')
        expect(deskPath(8, 'annual report')).toBe('/p/8/skill/annual%20report')
    })
})

describe('libraryPath and viewerPath', () => {
    it('carry the principal even though a shipped skill has no owner', () => {

        expect(libraryPath(8)).toBe('/p/8/library')
        expect(viewerPath(8, 'typst')).toBe('/p/8/library/typst')
    })

    it('are unscoped with no principal — the legacy `/library` shapes', () => {
        expect(libraryPath(null)).toBe('/library')
        expect(viewerPath(null, 'typst')).toBe('/library/typst')
    })

    it('encode a shipped skill name too', () => {
        expect(viewerPath(8, 'a/b')).toBe('/p/8/library/a%2Fb')
    })
})

describe('the two vocabularies stay in step', () => {
    it('produces paths the local router and the host mapping both know', () => {
        // Each path here must resolve to a registered route *and* survive the round
        // trip through the host mapping, or a link the panel renders 404s on reload.
        const produced = [
            homePath(8),
            newSkillPath(8),
            deskPath(8, 'invoice-drafting'),
            libraryPath(8),
            viewerPath(8, 'typst'),
        ]
        expect(produced).toEqual([
            '/p/8',
            '/p/8/new',
            '/p/8/skill/invoice-drafting',
            '/p/8/library',
            '/p/8/library/typst',
        ])
    })
})