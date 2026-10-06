/**
 * Where a host URL for a skill points inside this app.
 *
 * This plugin's own `CustomSkillSearchProvider` links a skill the way its kind
 * reads: an own (custom) skill as `/apps/custom-skills/skill/{name}`, a shipped one
 * as `/apps/custom-skills/library/{name}` — the same detail-vs-catalog split
 * `spora-plugin-media-archive` uses for an asset (`/apps/media-archive/asset/{id}`
 * against its listing). The host router registers no child route for either, so the
 * app parses the path itself. That is what makes browser back/forward, a hard
 * refresh and a pasted link all land on the same skill: the path is the source of
 * truth, and nothing has to be remembered in memory for it to survive a reload.
 *
 * Core shipped a `SkillSearchProvider` until spora-core#292 and emitted neither
 * prefix: it built `/apps/{source}/skill/{name}` from the skill's *owner*, or `null`
 * when no app was registered under that source — which was every shipped skill.
 *
 * Following the kind rather than collapsing both onto one route is the point: a
 * shipped skill is global and read-only while a custom one is principal-scoped and
 * writable, so a shipped skill opened on the desk renders a read-only page under a
 * scope bar announcing a principal it does not have. The host names the kind in the
 * path, which keeps this a pure prefix map — no catalogue lookup, no await, no
 * answer that can arrive after the route has already been decided.
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

/** Which of the app's two skill surfaces a host link points at. */
export type SkillKind = 'desk' | 'viewer'

/** A skill a host path names, and which surface shows it. */
export interface SkillRef {
    name: string
    kind: SkillKind
}

/** `?skill=x` was what the provider emitted before it moved to a path segment. */
const LEGACY_QUERY_KEY = 'skill'

/** The local route prefix per kind — the whole host-to-local mapping, in one place. */
const LOCAL_PREFIX: Record<SkillKind, string> = { desk: '/skills', viewer: '/library' }

/**
 * The skill named by a host path and the kind it is, or null when the path is not
 * a skill link.
 *
 * Accepts any `/apps/{app}/skill/{name}` and `/apps/{app}/library/{name}` prefix,
 * because the app slug is the only thing that varies: the panel is mounted at one
 * app, and matching the whole path would break the link rather than follow it.
 */
export function extractSkillRef(path: string): SkillRef | null {
    const match = /^\/apps\/[^/]+\/(skill|library)\/([^/]+)$/.exec(path)
    if (match?.[2] === undefined) return null
    // A percent-encoded name is a legal skill name, so it is decoded here rather
    // than left to fail against a directory that does not exist.
    try {
        return {
            name: decodeURIComponent(match[2]),
            kind: match[1] === 'library' ? 'viewer' : 'desk',
        }
    } catch {
        return null
    }
}

/**
 * The local route a host path should land on, or null to leave the app where it is.
 *
 * The legacy query form is accepted alongside the paths, because a bookmark or a
 * pasted link made under the old shape is still a link someone holds. It means the
 * desk: core only emitted an href for a skill whose owning plugin had an app, which
 * back then meant source=custom-skills, so every such link named a custom skill.
 */
export function localRouteForHostRoute(route: HostRoute | null): string | null {
    if (route === null) return null

    const ref = extractSkillRef(route.path)
    if (ref !== null && ref.name !== '') return `${LOCAL_PREFIX[ref.kind]}/${encodeURIComponent(ref.name)}`

    const legacy = route.query?.[LEGACY_QUERY_KEY]
    if (typeof legacy === 'string' && legacy !== '') return `/skills/${encodeURIComponent(legacy)}`

    return null
}
