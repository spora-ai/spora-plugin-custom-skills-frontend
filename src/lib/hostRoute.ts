/**
 * Between a host URL and a local route — both directions.
 *
 * **The host path is the single source of truth.** It is what the address bar shows,
 * what a bookmark stores, and what a reload re-reads, so a path the panel cannot
 * reproduce from the URL is a path that does not survive the tab. `spora-plugin-
 * media-archive` works the same way and says so in `lib/route-detection.ts`: it
 * pushes real host paths and follows them back through `afterEach`, rather than
 * driving itself from a private memory-history route nobody else can see.
 *
 * Because the host owns the address bar, this plugin keeps a *local* mirror of the
 * path — but the mirror is a mirror, not a second vocabulary. A local path is the
 * host path minus `/apps/{app}`, so both directions are a prefix strip and a prefix
 * append rather than a table of kinds. That is what makes an added page impossible
 * to leave out of the mapping, which is the failure mode a `skill` → `/skills/{name}`
 * table invites.
 *
 * **The principal is in the path.** A skill belongs to exactly one principal
 * (`unique(principal_id, name)`), so a URL naming a skill and nothing else cannot say
 * *whose* skill it is — and the contract resolves an absent `?principal_id=` to the
 * caller's own user-principal rather than refusing. That silent default is what made a
 * group-owned skill 404 as "No skill named … on this principal" when opened from the
 * palette. `p/{pid}` carries it on every panel path, the catalogue included: a shipped
 * skill has no owner, but the acting principal is what *Duplicate* writes into.
 *
 * Legacy hrefs are still followed, then canonicalised with a `replace`: `/skill/{name}`,
 * `/library[/{name}]` from before the principal moved into the path, and the older
 * `?skill=` query form. A bookmark made under the old shape is still a link someone
 * holds; rewriting it silently into the current one is friendlier than a 404 and
 * cannot change which principal is read, because those shapes carry none.
 *
 * The app slug is resolved rather than hard-coded so a panel mounted under another name
 * still writes correct URLs, and is read *tolerantly* — matching `/apps/{anything}/`
 * — because a link is a link, and a rename should follow it rather than break it.
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
 * The app slug this panel is mounted under, or the fallback when the host says nothing
 * usable. `route.params.appName` is authoritative — the host registers
 * `/apps/:appName/:rest*`, so the param is the slug it actually resolved.
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
 * Legacy shapes collapse onto the same canonical local paths, so a caller never has to
 * know which shape a link used — only `main.ts` does, when it canonicalises the URL.
 * The returned path always carries the principal for the shapes that have one; a
 * legacy shape has none to carry, and the app fills in the default (see
 * `canonicalLocalPath`).
 */
export function localPathForHostPath(path: string, appSlug: string): string | null {
    const prefix = `/apps/${appSlug}`
    if (path === prefix || path === `${prefix}/`) return '/'
    if (!path.startsWith(`${prefix}/`)) return null

    const rest = path.slice(prefix.length + 1)

    // The pre-principal shapes, collapsed onto their unscoped local equivalents so a
    // caller never has to know which shape a link used. The name stays
    // percent-encoded: the local router decodes the segment into `params` either way,
    // and keeping the encoded form is what makes the round trip idempotent — decoding
    // here and re-encoding on the way out would be a lossy pair.
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
 * The query is only consulted on the app root, which is the only path it was ever
 * emitted against — a `?skill=` riding along on `/apps/custom-skills/library/typst`
 * is a stale link, and honouring it would re-point the viewer at a desk.
 */
export function localPathForHostRoute(route: HostRoute | null, appSlug: string): string | null {
    if (route === null) return null

    const prefix = `/apps/${appSlug}`
    const isRoot = route.path === prefix || route.path === `${prefix}/`

    const fromPath = localPathForHostPath(route.path, appSlug)
    if (fromPath !== null && !isRoot) return fromPath

    // A percent-encoded name is a legal skill name, so it is carried across rather
    // than decoded into a path that cannot be re-parsed.
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
 * `null` is a real answer, not a gap: `/library` and a legacy `/skill/{name}` are
 * principal-less, and the app resolves those against the caller's own principal —
 * the same default the REST contract applies to an absent `?principal_id=`.
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
 * The local path for `localPath` under the principal the app resolved.
 *
 * Two jobs, both done by `App.vue` once `GET /principals/me` has answered:
 *
 * - A **principal-less** path is rewritten into its scoped form, which is what turns
 *   `/apps/custom-skills` into `/apps/custom-skills/p/{id}`. The operator still
 *   landed on their own skills, but the URL now survives a reload and a paste.
 * - A path naming a principal the caller **cannot act as** has its principal
 *   replaced with the resolved one, so the address bar stops claiming a scope the
 *   panel is not showing. Nothing leaks either way — the API refuses it too — but
 *   rewriting stops the URL disagreeing with the screen.
 *
 * A path already naming the resolved principal is returned untouched: it must not be
 * rewritten to a *different* principal, or a desk would silently re-point at another
 * principal's identically-named skill mid-edit, which is the one outcome the scope bar
 * navigating rather than mutating exists to prevent.
 */
export function canonicalLocalPath(localPath: string, principalId: number | null): string {
    if (principalId === null) return localPath

    const named = principalIdInLocalPath(localPath)
    if (named === principalId) return localPath

    const rest = named === null ? localPath : localPath.replace(/^\/p\/\d+/, '')
    return `/p/${principalId}${rest === '/' ? '' : rest}`
}

/**
 * Whether a local path is the catalogue or the shipped-skill viewer.
 *
 * Read off the path's first segment rather than `route.name`, because the home route
 * has two names (scoped and unscoped) and a string prefix check against `/library`
 * silently stopped matching the moment the principal moved into the path.
 */
export function isLibraryPath(localPath: string): boolean {
    return /^\/(?:p\/\d+\/)?library(?:\/|$)/.test(localPath)
}