/**
 * Between a host URL and a local route — both directions.
 *
 * **The host path is the single source of truth:** what the address bar shows, a bookmark stores and
 * a reload re-reads. A local path is the host path minus `/apps/{app}` — a prefix strip and append
 * rather than a table of kinds, so an added page cannot be left out.
 *
 * **The principal is in the path.** A skill belongs to one principal (`unique(principal_id, name)`),
 * and the contract resolves an absent `?principal_id=` to the *caller's own* rather than refusing —
 * the silent default behind a group-owned skill 404-ing from the palette. `p/{pid}` rides on every
 * panel path, catalogue included: a shipped skill has no owner, but the acting principal is what
 * *Duplicate* writes into. Legacy shapes are still followed; the app slug is read tolerantly so a
 * rename follows the link rather than breaking it.
 */

export interface HostRoute {
    path: string
    params?: Record<string, unknown>
    query?: Record<string, unknown>
}

const FALLBACK_APP_SLUG = 'custom-skills'

/** `?skill=x` was what the provider emitted before it moved to a path segment. */
const LEGACY_QUERY_KEY = 'skill'

/** Matches `/apps/{app}` and nothing deeper, so the slug can be read off a path. */
const APP_PREFIX = /^\/apps\/([^/]+)/

/** `route.params.appName` is authoritative — it is the slug the host resolved. */
export function appSlugFrom(route: HostRoute | null): string {
    const fromParams = route?.params?.['appName']
    if (typeof fromParams === 'string' && fromParams !== '') return fromParams

    const path = route?.path
    if (typeof path === 'string') {
        const match = APP_PREFIX.exec(path)
        if (match?.[1] !== undefined && match[1] !== '') return match[1]
    }

    return FALLBACK_APP_SLUG
}

/** The local path for a host path, or null when it is not this app's panel. */
export function localPathForHostPath(path: string, appSlug: string): string | null {
    const prefix = `/apps/${appSlug}`
    if (path === prefix || path === `${prefix}/`) return '/'
    if (!path.startsWith(`${prefix}/`)) return null

    const rest = path.slice(prefix.length + 1)

    // Pre-principal shapes, unscoped. The name stays percent-encoded: the router decodes either way.
    const legacy = /^(skill|library)\/([^/]+)$/.exec(rest)
    if (legacy !== null) {
        return `/${legacy[1]}/${legacy[2]}`
    }

    if (rest === 'skill') return '/'
    if (rest === 'library') return '/library'

    return `/${rest}`
}

/** The local path for a host route, honouring the legacy `?skill=` form — read only on the app root,
 *  the only path it was emitted against; elsewhere it is stale and would re-point a viewer at a desk. */
export function localPathForHostRoute(route: HostRoute | null, appSlug: string): string | null {
    if (route === null) return null

    const prefix = `/apps/${appSlug}`
    const isRoot = route.path === prefix || route.path === `${prefix}/`

    const fromPath = localPathForHostPath(route.path, appSlug)
    if (fromPath !== null && !isRoot) return fromPath

    // Re-encoded on the way out though vue-router already decoded the value: this href can be
    // anything someone pastes, and `?skill=..%2F..%2Fadmin` arrives as `../../admin` — raw, a real
    // path traversal. A legal name is `[a-z0-9-]`.
    const legacy = route.query?.[LEGACY_QUERY_KEY]
    if (typeof legacy === 'string' && legacy !== '') {
        return `/skill/${encodeURIComponent(legacy)}`
    }

    return fromPath
}

export function hostPathForLocalPath(localPath: string, appSlug: string): string {
    const rest = localPath === '/' ? '' : localPath.replace(/^\//, '')
    return rest === '' ? `/apps/${appSlug}` : `/apps/${appSlug}/${rest}`
}

/** The principal a local path is scoped to, or null — a real answer: those paths resolve to the
 *  caller's own principal, the contract's default for an absent `?principal_id=`. */
export function principalIdInLocalPath(localPath: string): number | null {
    const match = /^\/p\/(\d+)(?:\/|$)/.exec(localPath)
    if (match?.[1] === undefined) return null

    const id = Number(match[1])
    // `p/0` parses and is not an id the contract accepts; `Number.isSafeInteger` keeps a long
    // digit run from becoming a float.
    return Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * The local path under the principal the app resolved. A principal-less path becomes scoped; an
 * inaccessible one is replaced, so the address bar stops claiming a scope the panel is not showing.
 * A path already naming the resolved principal is untouched — rewriting it would silently re-point a
 * desk at another principal's identically-named skill mid-edit.
 */
export function canonicalLocalPath(localPath: string, principalId: number | null): string {
    if (principalId === null) return localPath

    const named = principalIdInLocalPath(localPath)
    if (named === principalId) return localPath

    // `[^/]+`, not `\d+`: `/p/0` and `/p/abc` parse to no principal, so a strip keyed on
    // `principalIdInLocalPath` would leave them and *prepend* `/p/7/p/0/skill/x` — no route matches,
    // and the sync writes it into the address bar.
    const rest = /^\/p\/[^/]+/.test(localPath)
        ? localPath.replace(/^\/p\/[^/]+/, '') || '/'
        : localPath

    return `/p/${principalId}${rest === '/' ? '' : rest}`
}

/** Whether a local path is the catalogue or the viewer. Read off the path, not `route.name`: home
 *  has two names (scoped and unscoped). */
export function isLibraryPath(localPath: string): boolean {
    return /^\/(?:p\/\d+\/)?library(?:\/|$)/.test(localPath)
}
