/**
 * Where a host URL for a skill points inside this app.
 *
 * Core's `SkillSearchProvider` links a skill as `/apps/custom-skills/skill/{name}`
 * — the same shape `spora-plugin-media-archive` uses for an asset
 * (`/apps/media-archive/asset/{id}`). The host router registers no child route for
 * either, so the app parses the path itself. That is what makes browser
 * back/forward, a hard refresh and a pasted link all land on the same skill: the
 * path is the source of truth, and nothing has to be remembered in memory for it
 * to survive a reload.
 *
 * The app slug is read from the host route rather than hard-coded, so the panel
 * still works if the plugin is ever mounted under a different app name.
 */

/** The host's own route, as far as this app can see it. */
export interface HostRoute {
    path: string
    params?: Record<string, unknown>
    query?: Record<string, unknown>
}

/** `?skill=x` was what the provider emitted before it moved to a path segment. */
const LEGACY_QUERY_KEY = 'skill'

/**
 * The skill named by a host path, or null when the path is not a skill link.
 *
 * Accepts any `/apps/{app}/skill/{name}` prefix, because the only thing that
 * matters is the trailing segment: the panel is mounted at one app, and matching
 * the whole path would break if the host ever nests it differently.
 */
export function extractSkillName(path: string): string | null {
    const match = /^\/apps\/[^/]+\/skill\/([^/]+)$/.exec(path)
    if (match?.[1] === undefined) return null
    // A percent-encoded name is a legal skill name, so it is decoded here rather
    // than left to fail against a directory that does not exist.
    try {
        return decodeURIComponent(match[1])
    } catch {
        return null
    }
}

/**
 * The local route a host path should land on, or null to leave the app where it is.
 *
 * Both forms are accepted: the path the provider emits now, and the query
 * parameter it emitted before, because a bookmark or a pasted link made under the
 * old shape is still a link someone holds.
 *
 * Shipped skills resolve through the same desk route. `SkillDeskPage` reads the
 * acting principal's skills first and falls back to the host catalogue, so one
 * route covers both and the search hit does not have to know which it is.
 */
export function localRouteForHostRoute(route: HostRoute | null): string | null {
    if (route === null) return null

    const fromPath = extractSkillName(route.path)
    if (fromPath !== null && fromPath !== '') return `/skills/${encodeURIComponent(fromPath)}`

    const legacy = route.query?.[LEGACY_QUERY_KEY]
    if (typeof legacy === 'string' && legacy !== '') return `/skills/${encodeURIComponent(legacy)}`

    return null
}
