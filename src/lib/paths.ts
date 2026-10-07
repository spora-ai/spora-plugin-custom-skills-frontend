/**
 * Every path the panel navigates to, in one place.
 *
 * The principal is in every panel path, so a link built by string-concatenating a skill
 * name silently drops the scope — and that is exactly the bug this module exists to
 * make structurally impossible: `deskPath(principalId, name)` cannot be called without
 * a principal, where `` `/skills/${skill.name}` `` could. Roughly fifteen call sites
 * across the pages and the scope bar build a path today; each of them was an
 * independent chance to re-open the same wrong-scope report.
 *
 * Pure and dependency-free, so the route table and the links that target it are
 * testable without mounting anything.
 */

/** A local path is the host path minus `/apps/{app}` — see `lib/hostRoute.ts`. */
export type PanelPath = string

/** A skill name is user-supplied, so a `/` or a space would forge a different path. */
function encodeName(name: string): string {
    return encodeURIComponent(name)
}

/** Home, scoped. `null` is the bare root, which means the default principal. */
export function homePath(principalId: number | null): PanelPath {
    return principalId === null ? '/' : `/p/${principalId}`
}

/** The create form, scoped — a new skill is written to the acting principal. */
export function newSkillPath(principalId: number | null): PanelPath {
    return principalId === null ? '/new' : `/p/${principalId}/new`
}

/** The desk for one skill of one principal. */
export function deskPath(principalId: number | null, name: string): PanelPath {
    const segment = `/skill/${encodeName(name)}`
    return principalId === null ? segment : `/p/${principalId}${segment}`
}

/** The catalogue of shipped skills. */
export function libraryPath(principalId: number | null): PanelPath {
    return principalId === null ? '/library' : `/p/${principalId}/library`
}

/** The read-only viewer for one shipped skill. */
export function viewerPath(principalId: number | null, name: string): PanelPath {
    const segment = `/library/${encodeName(name)}`
    return principalId === null ? segment : `/p/${principalId}${segment}`
}