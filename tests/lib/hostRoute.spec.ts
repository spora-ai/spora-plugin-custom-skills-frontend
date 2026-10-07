/**
 * Between a host URL and a local route — both directions, and the round trip.
 *
 * The host path is the source of truth for this panel, so the two directions are not
 * symmetric conveniences: a local path that cannot be turned back into the host path it
 * came from is a path the operator cannot share. The round trip asserted below is what
 * makes a page impossible to add to the local router without also adding it to the
 * mapping.
 */
import { describe, it, expect } from 'vitest'
import {
    appSlugFrom,
    canonicalLocalPath,
    hostPathForLocalPath,
    isLibraryPath,
    localPathForHostPath,
    localPathForHostRoute,
    principalIdInLocalPath,
} from '../../src/lib/hostRoute'

const SLUG = 'custom-skills'

/** Every canonical host path, paired with the local path it must produce. */
const CANONICAL: Array<[host: string, local: string]> = [
    ['/apps/custom-skills', '/'],
    ['/apps/custom-skills/', '/'],
    ['/apps/custom-skills/p/7', '/p/7'],
    ['/apps/custom-skills/p/8/new', '/p/8/new'],
    ['/apps/custom-skills/p/8/skill/invoice-drafting', '/p/8/skill/invoice-drafting'],
    ['/apps/custom-skills/p/8/library', '/p/8/library'],
    ['/apps/custom-skills/p/8/library/typst', '/p/8/library/typst'],
]

describe('localPathForHostPath', () => {
    it.each(CANONICAL)('reads %s as %s', (host, local) => {
        expect(localPathForHostPath(host, SLUG)).toBe(local)
    })

    it('is the exact inverse of hostPathForLocalPath, for every canonical path', () => {

        for (const host of CANONICAL.map(([h]) => h)) {
            const local = localPathForHostPath(host, SLUG)
            expect(local).not.toBeNull()
            expect(hostPathForLocalPath(local!, SLUG)).toBe(host.replace(/\/$/, '') || host)
        }
    })

    it('follows a link emitted under an app slug other than this plugin\'s', () => {

        expect(localPathForHostPath('/apps/some-other-app/p/7/skill/report', 'some-other-app'))
            .toBe('/p/7/skill/report')
    })

    it('does not match another app\'s path when mounted under this one', () => {

        expect(localPathForHostPath('/apps/media-archive/asset/9', SLUG)).toBeNull()
        expect(localPathForHostPath('/agents/5', SLUG)).toBeNull()
        expect(localPathForHostPath('/', SLUG)).toBeNull()
    })

    it('carries a percent-encoded name through untouched', () => {

        expect(localPathForHostPath('/apps/custom-skills/p/7/skill/annual%20report', SLUG))
            .toBe('/p/7/skill/annual%20report')
        expect(localPathForHostPath('/apps/custom-skills/skill/annual%20report', SLUG))
            .toBe('/skill/annual%20report')
    })

    it('treats a bare /skill as the unscoped home, since no skill is named', () => {
        expect(localPathForHostPath('/apps/custom-skills/skill', SLUG)).toBe('/')
    })
})

describe('localPathForHostRoute — the legacy shapes', () => {
    it('follows the pre-principal /skill/{name} href onto an unscoped desk', () => {

        expect(localPathForHostPath('/apps/custom-skills/skill/report', SLUG)).toBe('/skill/report')
    })

    it('follows the pre-principal /library shapes', () => {
        expect(localPathForHostPath('/apps/custom-skills/library', SLUG)).toBe('/library')
        expect(localPathForHostPath('/apps/custom-skills/library/typst', SLUG)).toBe('/library/typst')
    })

    it('still accepts the oldest query form', () => {

        expect(localPathForHostRoute({ path: '/apps/custom-skills', query: { skill: 'report' } }, SLUG))
            .toBe('/skill/report')
    })

    it('prefers the path over the legacy query when both are present', () => {

        expect(localPathForHostRoute({ path: '/apps/custom-skills/p/8/skill/b', query: { skill: 'a' } }, SLUG))
            .toBe('/p/8/skill/b')
    })

    it('leaves the app where it is for a query it cannot use', () => {
        expect(localPathForHostRoute({ path: '/apps/custom-skills', query: { skill: '' } }, SLUG)).toBe('/')
        expect(localPathForHostRoute({ path: '/apps/custom-skills', query: { skill: 7 } }, SLUG)).toBe('/')
        expect(localPathForHostRoute({ path: '/apps/custom-skills', query: { page: '2' } }, SLUG)).toBe('/')
        expect(localPathForHostRoute(null, SLUG)).toBeNull()
    })

    it('ignores a stale ?skill= on a path that is not the app root', () => {

        expect(localPathForHostRoute(
            { path: '/apps/custom-skills/library/typst', query: { skill: 'report' } },
            SLUG,
        )).toBe('/library/typst')
    })
})

describe('principalIdInLocalPath', () => {
    it('reads the principal off a scoped path', () => {
        expect(principalIdInLocalPath('/p/8/skill/report')).toBe(8)
        expect(principalIdInLocalPath('/p/8')).toBe(8)
        expect(principalIdInLocalPath('/p/8/library')).toBe(8)
    })

    it('is null for a path that names none', () => {

        expect(principalIdInLocalPath('/')).toBeNull()
        expect(principalIdInLocalPath('/library')).toBeNull()
        expect(principalIdInLocalPath('/skill/report')).toBeNull()
    })

    it('is null for an id no principal could have', () => {

        expect(principalIdInLocalPath('/p/0')).toBeNull()
        expect(principalIdInLocalPath('/p/99999999999999999999')).toBeNull()
        expect(principalIdInLocalPath('/p/abc')).toBeNull()
    })

    it('is not fooled by a segment that merely starts with p/', () => {
        expect(principalIdInLocalPath('/panel/8')).toBeNull()
        expect(principalIdInLocalPath('/skill/p/8')).toBeNull()
    })
})

describe('canonicalLocalPath', () => {
    it('puts the resolved principal on a path that named none', () => {

        expect(canonicalLocalPath('/', 7)).toBe('/p/7')
        expect(canonicalLocalPath('/library', 8)).toBe('/p/8/library')
        expect(canonicalLocalPath('/library/typst', 8)).toBe('/p/8/library/typst')
        expect(canonicalLocalPath('/skill/report', 8)).toBe('/p/8/skill/report')
    })

    it('leaves the path alone when there is no principal to name', () => {

        expect(canonicalLocalPath('/', null)).toBe('/')
        expect(canonicalLocalPath('/library', null)).toBe('/library')
    })

    it('leaves a path alone when it already names the resolved principal', () => {

        expect(canonicalLocalPath('/p/7/skill/report', 7)).toBe('/p/7/skill/report')
    })

    it('replaces a principal the caller cannot act as, so the URL matches the screen', () => {

        expect(canonicalLocalPath('/p/4242/skill/report', 7)).toBe('/p/7/skill/report')
        expect(canonicalLocalPath('/p/4242/library', 7)).toBe('/p/7/library')
        expect(canonicalLocalPath('/p/4242', 7)).toBe('/p/7')
    })
})

describe('appSlugFrom', () => {
    it('prefers the slug the host resolved in its params', () => {

        expect(appSlugFrom({ path: '/apps/custom-skills', params: { appName: 'custom-skills' } }))
            .toBe('custom-skills')
    })

    it('reads the slug off the path when the params carry nothing', () => {
        expect(appSlugFrom({ path: '/apps/custom-skills/p/8/library' })).toBe('custom-skills')
    })

    it('falls back rather than throwing when the host says nothing usable', () => {
        expect(appSlugFrom(null)).toBe('custom-skills')
        expect(appSlugFrom({ path: '/agents/5' })).toBe('custom-skills')
        expect(appSlugFrom({ path: '/apps/custom-skills', params: { appName: '' } })).toBe('custom-skills')
    })
})

describe('isLibraryPath', () => {
    it('recognises the catalogue and the viewer, scoped or not', () => {

        expect(isLibraryPath('/library')).toBe(true)
        expect(isLibraryPath('/library/typst')).toBe(true)
        expect(isLibraryPath('/p/8/library')).toBe(true)
        expect(isLibraryPath('/p/8/library/typst')).toBe(true)
    })

    it('does not mistake the desk or home for the catalogue', () => {
        expect(isLibraryPath('/')).toBe(false)
        expect(isLibraryPath('/p/8')).toBe(false)
        expect(isLibraryPath('/p/8/skill/library-notes')).toBe(false)
        expect(isLibraryPath('/skill/report')).toBe(false)
        expect(isLibraryPath('/new')).toBe(false)
    })
})