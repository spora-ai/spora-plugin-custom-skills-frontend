/**
 * Where a host URL for a skill points inside the app.
 *
 * This plugin's `CustomSkillSearchProvider` links a skill by kind:
 * `/apps/custom-skills/skill/{name}` for an own one, `/apps/custom-skills/library/{name}`
 * for a shipped one. The host router registers no child route for either, so the app
 * parses the path itself, the way `spora-plugin-media-archive` does for an asset.
 */
import { describe, it, expect } from 'vitest'
import { extractSkillRef, localRouteForHostRoute } from '../../src/lib/hostRoute'

describe('extractSkillRef', () => {
    it('reads an own skill off a skill detail path', () => {
        expect(extractSkillRef('/apps/custom-skills/skill/invoice-drafting'))
            .toEqual({ name: 'invoice-drafting', kind: 'desk' })
    })

    it('reads a shipped skill off a library path, as the viewer kind', () => {
        expect(extractSkillRef('/apps/custom-skills/library/time-arithmetic'))
            .toEqual({ name: 'time-arithmetic', kind: 'viewer' })
    })

    it('does not care which app slug it is mounted under', () => {
        // The panel is mounted at one app, but the host may nest it differently one
        // day; matching the whole path would break the link rather than follow it.
        expect(extractSkillRef('/apps/some-other-app/skill/report'))
            .toEqual({ name: 'report', kind: 'desk' })
        expect(extractSkillRef('/apps/some-other-app/library/report'))
            .toEqual({ name: 'report', kind: 'viewer' })
    })

    it('decodes a percent-encoded name, because one is a legal skill name', () => {
        expect(extractSkillRef('/apps/custom-skills/skill/annual%20report'))
            .toEqual({ name: 'annual report', kind: 'desk' })
    })

    it('returns null for a path that is not a skill link', () => {
        expect(extractSkillRef('/apps/custom-skills')).toBeNull()
        expect(extractSkillRef('/apps/custom-skills/')).toBeNull()
        // The catalogue itself, with no skill named after it.
        expect(extractSkillRef('/apps/custom-skills/library')).toBeNull()
        expect(extractSkillRef('/')).toBeNull()
        expect(extractSkillRef('/spora/settings')).toBeNull()
    })

    it('does not match a deeper path, which would open the wrong skill', () => {
        expect(extractSkillRef('/apps/custom-skills/skill/a/b')).toBeNull()
        expect(extractSkillRef('/apps/custom-skills/library/a/b')).toBeNull()
    })

    it('returns null rather than throwing on a broken escape', () => {
        expect(extractSkillRef('/apps/custom-skills/skill/%E0%A4%A')).toBeNull()
        expect(extractSkillRef('/apps/custom-skills/library/%E0%A4%A')).toBeNull()
    })
})

describe('localRouteForHostRoute', () => {
    it('sends an own skill to the writable desk', () => {
        expect(localRouteForHostRoute({ path: '/apps/custom-skills/skill/report' }))
            .toBe('/skills/report')
    })

    it('sends a shipped skill to the read-only viewer, not the desk', () => {
        // The desk route is where the bug lived: it renders the DESK read-only,
        // with the principal's own skill substituted for placeholder fields, under
        // a scope bar announcing a principal a shipped skill has none of.
        expect(localRouteForHostRoute({ path: '/apps/custom-skills/library/time-arithmetic' }))
            .toBe('/library/time-arithmetic')
    })

    it('encodes the name, so a space cannot break the local route', () => {
        expect(localRouteForHostRoute({ path: '/apps/custom-skills/skill/annual%20report' }))
            .toBe('/skills/annual%20report')
        expect(localRouteForHostRoute({ path: '/apps/custom-skills/library/annual%20report' }))
            .toBe('/library/annual%20report')
    })

    it('follows a link emitted under an app slug other than this plugin\'s', () => {
        expect(localRouteForHostRoute({ path: '/apps/some-other-app/skill/report' }))
            .toBe('/skills/report')
        expect(localRouteForHostRoute({ path: '/apps/some-other-app/library/report' }))
            .toBe('/library/report')
    })

    it('still accepts the query form, which is a link someone may hold', () => {
        // The provider emitted `?skill=` before it moved to a path segment, so a
        // bookmarked or shared link made under the old shape still has to land. Every
        // such link named a custom skill — core only emitted an href when the owning
        // plugin had an app, which back then meant source=custom-skills — so the desk
        // is where it belongs.
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
})
