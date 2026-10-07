/**
 * Between a host URL and a local route — both directions.
 *
 * **The host path is the single source of truth:** it is what the address bar shows, a
 * bookmark stores and a reload re-reads, so a path the panel cannot reproduce from the
 * URL does not survive the tab. A local path is therefore the host path minus
 * `/apps/{app}` — a prefix strip and a prefix append rather than a table of kinds,
 * which is what makes an added page impossible to leave out of the mapping.
 *
 * **The principal is in the path.** A skill belongs to exactly one principal
 * (`unique(principal_id, name)`), and the contract resolves an absent `?principal_id=`
 * to the *caller's own* rather than refusing — the silent default behind a group-owned
 * skill 404-ing as "No skill named … on this principal" when opened from the palette.
 * `p/{pid}` rides on every panel path, the catalogue included: a shipped skill has no
 * owner, but the acting principal is what *Duplicate* writes into.
 *
 * Legacy shapes — `/skill/{name}`, `/library[/{name}]`, `?skill=` — are still followed,
 * then canonicalised by `App.vue`. A link made under an old shape is still a link
 * someone holds, and rewriting it cannot change which principal is read because those
 * shapes carry none.
 *
 * The app slug is read *tolerantly* — matching `/apps/{anything}/` — because a link is
 * a link, and a rename should follow it rather than break it.
 */

/** The host's own route, as far as this app can see it. */
export interface HostRoute {
    path: string
    params?: Record<string, unknown>
    query?: Record<string, unknown>
}

/** Used when the host exposes neither a route nor a path carrying the slug. */
const FALLBACK_APP_SLUG = 'custom-skills'

/** `?skill=x` was what the provider emitted before it moved to a path segment. */
const LEGACY_QUERY_KEY = 'skill'

/** Matches `/apps/{app}` and nothing deeper, so the slug can be read off a path. */
const APP_PREFIX = /^\/apps\/([^/]+)/

/**
 * The app slug this panel is mounted under. `route.params.appName` is authoritative —
 * the host registers `/apps/:appName/:rest*`, so the param is the slug it resolved.
 */
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

/**
 * The local path for a host path, or null when the path is not this app's panel.
 *
 * The principal is carried through whenever the path has one; a legacy shape has none,
 * and `canonicalLocalPath` fills in the default.
 */
export function localPathForHostPath(path: string, appSlug: string): string | null {
    const prefix = `/apps/${appSlug}`
    if (path === prefix || path === `${prefix}/`) return '/'
    if (!path.startsWith(`${prefix}/`)) return null

    const rest = path.slice(prefix.length + 1)

    // The pre-principal shapes, unscoped, so a caller need not know which shape a link
    // used. The name stays percent-encoded: the local router decodes the segment into
    // `params` either way, and re-encoding on the way out would be a lossy pair.
    const legacy = /^(skill|library)\/([^/]+)$/.exec(rest)
    if (legacy !== null) {
        return `/${legacy[1]}/${legacy[2]}`
    }

    if (rest === 'skill') return '/'
    if (rest === 'library') return '/library'

    return `/${rest}`
}

/**
 * The local path for the host route, honouring the legacy `?skill=` form.
 *
 * The query is read only on the app root, the only path it was ever emitted against. A
 * `?skill=` riding along on a viewer link is stale, and honouring it would re-point the
 * viewer at a desk.
 */
export function localPathForHostRoute(route: HostRoute | null, appSlug: string): string | null {
    if (route === null) return null

    const prefix = `/apps/${appSlug}`
    const isRoot = route.path === prefix || route.path === `${prefix}/`

    const fromPath = localPathForHostPath(route.path, appSlug)
    if (fromPath !== null && !isRoot) return fromPath

    // Interpolated raw, not encoded: vue-router has already decoded the query
    // value, and `SkillValidator::NAME_PATTERN` allows only `[a-z0-9-]`, so a
    // legal name contains no `/` or space to be forged with. Encoding here would
    // double-encode a name that is already decoded.
    const legacy = route.query?.[LEGACY_QUERY_KEY]
    if (typeof legacy === 'string' && legacy !== '') {
        return `/skill/${legacy}`
    }

    return fromPath
}

/** The host path for a local path — the inverse of `localPathForHostPath`. */
export function hostPathForLocalPath(localPath: string, appSlug: string): string {
    const rest = localPath === '/' ? '' : localPath.replace(/^\//, '')
    return rest === '' ? `/apps/${appSlug}` : `/apps/${appSlug}/${rest}`
}

/**
 * The principal a local path is scoped to, or null when it names none.
 *
 * `null` is a real answer, not a gap: those paths resolve against the caller's own
 * principal — the same default the REST contract applies to an absent `?principal_id=`.
 */
export function principalIdInLocalPath(localPath: string): number | null {
    const match = /^\/p\/(\d+)(?:\/|$)/.exec(localPath)
    if (match?.[1] === undefined) return null

    const id = Number(match[1])
    // `p/0` and `p/007` both parse; neither is a principal id the contract accepts,
    // and `Number.isSafeInteger` keeps a long digit run from becoming a float.
    return Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * The local path under the principal the app resolved. Two jobs:
 *
 * - A principal-less path becomes scoped — what turns `/apps/custom-skills` into
 *   `/apps/custom-skills/p/{id}`, so the operator's landing page survives a reload and
 *   a paste.
 * - A principal the caller cannot act as is *replaced* by the resolved one, so the
 *   address bar stops claiming a scope the panel is not showing. Nothing leaks either
 *   way — the API refuses it too.
 *
 * A path already naming the resolved principal is returned untouched: rewriting it to
 * any other would silently re-point a desk at another principal's identically-named
 * skill mid-edit.
 */
export function canonicalLocalPath(localPath: string, principalId: number | null): string {
    if (principalId === null) return localPath

    const named = principalIdInLocalPath(localPath)
    if (named === principalId) return localPath

    const rest = named === null ? localPath : localPath.replace(/^\/p\/\d+/, '')
    return `/p/${principalId}${rest === '/' ? '' : rest}`
}

/**
 * Whether a local path is the catalogue or the shipped-skill viewer. Read off the first
 * segment rather than `route.name`, because home has two names (scoped and unscoped) and
 * a `/library` prefix check stopped matching once the principal moved into the path.
 */
export function isLibraryPath(localPath: string): boolean {
    return /^\/(?:p\/\d+\/)?library(?:\/|$)/.test(localPath)
}