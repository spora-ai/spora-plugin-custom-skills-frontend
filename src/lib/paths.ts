/**
 * Every path the panel navigates to, in one place.
 *
 * The principal is in every panel path, so a link built by concatenating a skill name
 * silently drops the scope. `deskPath(principalId, name)` cannot be called without a
 * principal, where `` `/skills/${skill.name}` `` could — and roughly fifteen call sites
 * once did exactly that, each an independent chance to re-open the wrong-scope report.
 *
 * Pure and dependency-free, so the links that target the route table are testable
 * without mounting anything.
 */

/** A skill name is user-supplied, so a `/` or a space would forge a different path. */
function encodeName(name: string): string {
    return encodeURIComponent(name)
}

/** `null` is the bare root, which means the default principal — see `canonicalLocalPath`. */
export function homePath(principalId: number | null): string {
    return principalId === null ? '/' : `/p/${principalId}`
}

/** The create form, scoped — it *writes* to the principal in its path. */
export function newSkillPath(principalId: number | null): string {
    return principalId === null ? '/new' : `/p/${principalId}/new`
}

/** The desk for one skill of one principal. */
export function deskPath(principalId: number | null, name: string): string {
    const segment = `/skill/${encodeName(name)}`
    return principalId === null ? segment : `/p/${principalId}${segment}`
}

/** The catalogue of shipped skills. */
export function libraryPath(principalId: number | null): string {
    return principalId === null ? '/library' : `/p/${principalId}/library`
}

/**
 * The read-only viewer for one shipped skill. Scoped too: the skill has no owner, so
 * the id is the scope *Duplicate* would write a copy onto, and a link without one
 * would fork onto whatever the next load defaulted to.
 */
export function viewerPath(principalId: number | null, name: string): string {
    const segment = `/library/${encodeName(name)}`
    return principalId === null ? segment : `/p/${principalId}${segment}`
}