/**
 * Where a host URL for a skill points inside the app.
 *
 * Core's `SkillSearchProvider` links a skill as `/apps/custom-skills/skill/{name}`.
 * The host router registers no child route for that, so the app parses the path
 * itself, the way `spora-plugin-media-archive` does for an asset.
 */
import { describe, it, expect } from 'vitest'
import { extractSkillName, localRouteForHostRoute } from '../../src/lib/hostRoute'

describe('extractSkillName', () => {
    it('reads the name off a skill detail path', () => {
        expect(extractSkillName('/apps/custom-skills/skill/invoice-drafting')).toBe('invoice-drafting')
    })

    it('does not care which app slug it is mounted under', () => {
        // The panel is mounted at one app, but the host may nest it differently one
        // day; matching the whole path would break the link rather than follow it.
        expect(extractSkillName('/apps/some-other-app/skill/report')).toBe('report')
    })

    it('decodes a percent-encoded name, because one is a legal skill name', () => {
        expect(extractSkillName('/apps/custom-skills/skill/annual%20report')).toBe('annual report')
    })

    it('returns null for a path that is not a skill link', () => {
        expect(extractSkillName('/apps/custom-skills')).toBeNull()
        expect(extractSkillName('/apps/custom-skills/')).toBeNull()
        expect(extractSkillName('/')).toBeNull()
        expect(extractSkillName('/spora/settings')).toBeNull()
    })

    it('does not match a deeper path, which would open the wrong skill', () => {
        expect(extractSkillName('/apps/custom-skills/skill/a/b')).toBeNull()
    })

    it('returns null rather than throwing on a broken escape', () => {
        expect(extractSkillName('/apps/custom-skills/skill/%E0%A4%A')).toBeNull()
    })
})

describe('localRouteForHostRoute', () => {
    it('sends a skill path to the desk', () => {
        expect(localRouteForHostRoute({ path: '/apps/custom-skills/skill/report' }))
            .toBe('/skills/report')
    })

    it('encodes the name, so a space cannot break the local route', () => {
        expect(localRouteForHostRoute({ path: '/apps/custom-skills/skill/annual%20report' }))
            .toBe('/skills/annual%20report')
    })

    it('still accepts the query form, which is a link someone may hold', () => {
        // The provider emitted `?skill=` before it moved to a path segment, so a
        // bookmarked or shared link made under the old shape still has to land.
        expect(localRouteForHostRoute({ path: '/apps/custom-skills', query: { skill: 'report' } }))
            .toBe('/skills/report')
    })

    it('leaves the app where it is for any other host route', () => {
        expect(localRouteForHostRoute({ path: '/apps/custom-skills' })).toBeNull()
        expect(localRouteForHostRoute({ path: '/apps/custom-skills', query: { page: '2' } })).toBeNull()
        expect(localRouteForHostRoute({ path: '/apps/custom-skills', query: { skill: '' } })).toBeNull()
        expect(localRouteForHostRoute(null)).toBeNull()
    })

    it('ignores a non-string query value rather than stringifying it', () => {
        expect(localRouteForHostRoute({ path: '/apps/custom-skills', query: { skill: 7 } })).toBeNull()
    })

    it('uses one route for shipped and custom skills alike', () => {
        // The desk reads the acting principal's skills first and falls back to the
        // host catalogue, so the search hit does not have to know which it is.
        expect(localRouteForHostRoute({ path: '/apps/custom-skills/skill/time-arithmetic' }))
            .toBe('/skills/time-arithmetic')
        expect(localRouteForHostRoute({ path: '/apps/custom-skills/skill/hello-world' }))
            .toBe('/skills/hello-world')
    })
})
