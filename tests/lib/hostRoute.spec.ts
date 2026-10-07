/**
 * Between a host URL and a local route — both directions, and the round trip.
 *
 * The host path is the source of truth for this panel: the address bar, a bookmark,
 * a reload and a pasted link all go through here. So the two directions are not
 * symmetric conveniences — a local path that cannot be turned back into the host path
 * it came from is a path the operator cannot share, and a host path that cannot be
 * read is a link that silently does nothing.
 *
 * The round-trip property is the load-bearing case and is asserted directly below:
 * `hostPathForLocalPath(localPathForHostPath(p)) === p` for every canonical path.
 * That is what makes a page impossible to add to the local router without also adding
 * it to the mapping, which is the failure a hand-written table of kinds invites.
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
        // The property the whole module exists for. A page added to one side only
        // fails here, rather than in production as a link that goes nowhere.
        for (const host of CANONICAL.map(([h]) => h)) {
            const local = localPathForHostPath(host, SLUG)
            expect(local).not.toBeNull()
            expect(hostPathForLocalPath(local!, SLUG)).toBe(host.replace(/\/$/, '') || host)
        }
    })

    it('follows a link emitted under an app slug other than this plugin\'s', () => {
        // The panel is mounted at one app, but a rename should follow the link
        // rather than break it — a link is a link.
        expect(localPathForHostPath('/apps/some-other-app/p/7/skill/report', 'some-other-app'))
            .toBe('/p/7/skill/report')
    })

    it('does not match another app\'s path when mounted under this one', () => {
        // The flip side of the tolerance above: tolerance is for *this* panel's
        // links, not a claim over every app in the host.
        expect(localPathForHostPath('/apps/media-archive/asset/9', SLUG)).toBeNull()
        expect(localPathForHostPath('/agents/5', SLUG)).toBeNull()
        expect(localPathForHostPath('/', SLUG)).toBeNull()
    })

    it('carries a percent-encoded name through untouched', () => {
        // A percent-encoded name is a legal skill name. The router decodes the
        // segment into `params` either way, and keeping the encoded form is what
        // makes the round trip idempotent — decoding here and re-encoding on the way
        // out would be a lossy pair.
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
        // A bookmark or a palette hit from a version before the principal moved into
        // the path is still a link someone holds. It carries no principal, so it
        // resolves like any other principal-less path.
        expect(localPathForHostPath('/apps/custom-skills/skill/report', SLUG)).toBe('/skill/report')
    })

    it('follows the pre-principal /library shapes', () => {
        expect(localPathForHostPath('/apps/custom-skills/library', SLUG)).toBe('/library')
        expect(localPathForHostPath('/apps/custom-skills/library/typst', SLUG)).toBe('/library/typst')
    })

    it('still accepts the oldest query form', () => {
        // `?skill=` predates even the path segments. It still means the desk,
        // because every href core ever emitted named a custom skill.
        expect(localPathForHostRoute({ path: '/apps/custom-skills', query: { skill: 'report' } }, SLUG))
            .toBe('/skill/report')
    })

    it('prefers the path over the legacy query when both are present', () => {
        // Otherwise a stale `?skill=` rides along on a link that has moved on.
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
        // The query was only ever emitted against the root. Honouring one that rode
        // along on a viewer link would re-point the viewer at a desk.
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
        // A real answer, not a gap: these paths resolve against the caller's own
        // principal, the same default the REST contract applies to an absent
        // `?principal_id=`.
        expect(principalIdInLocalPath('/')).toBeNull()
        expect(principalIdInLocalPath('/library')).toBeNull()
        expect(principalIdInLocalPath('/skill/report')).toBeNull()
    })

    it('is null for an id no principal could have', () => {
        // `p/0` and a huge digit run would otherwise be selected and sent as
        // `?principal_id=`, which is an IDOR-shaped request built from a URL.
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
        // What makes `/apps/custom-skills` become `/apps/custom-skills/p/{id}`:
        // the operator still lands on their own skills, but the URL now survives a
        // reload and a paste.
        expect(canonicalLocalPath('/', 7)).toBe('/p/7')
        expect(canonicalLocalPath('/library', 8)).toBe('/p/8/library')
        expect(canonicalLocalPath('/library/typst', 8)).toBe('/p/8/library/typst')
        expect(canonicalLocalPath('/skill/report', 8)).toBe('/p/8/skill/report')
    })

    it('leaves the path alone when there is no principal to name', () => {
        // `/p/null` is a path that means nothing.
        expect(canonicalLocalPath('/', null)).toBe('/')
        expect(canonicalLocalPath('/library', null)).toBe('/library')
    })

    it('leaves a path alone when it already names the resolved principal', () => {
        // Guards against the tempting "fix" that rewrites the path to whatever the
        // store currently holds. That would silently re-point a desk at another
        // principal's identically-named skill, which is the one thing the scope bar
        // navigating (rather than mutating) exists to prevent.
        expect(canonicalLocalPath('/p/7/skill/report', 7)).toBe('/p/7/skill/report')
    })

    it('replaces a principal the caller cannot act as, so the URL matches the screen', () => {
        // A shared link to a group you have since left. The API refuses it too, so
        // nothing leaks — but leaving the path claiming a scope the panel is not
        // showing makes the URL disagree with what is on it, and the next reload
        // would disagree again.
        expect(canonicalLocalPath('/p/4242/skill/report', 7)).toBe('/p/7/skill/report')
        expect(canonicalLocalPath('/p/4242/library', 7)).toBe('/p/7/library')
        expect(canonicalLocalPath('/p/4242', 7)).toBe('/p/7')
    })
})

describe('appSlugFrom', () => {
    it('prefers the slug the host resolved in its params', () => {
        // The host registers `/apps/:appName/:rest*`, so this is the slug it
        // actually mounted — authoritative over anything parsed out of a path.
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
        // Section detection reads this rather than `route.name`, because home has
        // two names (scoped and unscoped) and a `/library` prefix check stopped
        // matching the moment the principal moved into the path.
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