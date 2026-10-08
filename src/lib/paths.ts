/**
 * Every path the panel navigates to, in one place.
 *
 * The principal is in every panel path, so a link built by concatenating a skill name silently
 * drops the scope. `deskPath(principalId, name)` cannot be called without a principal, where
 * `` `/skills/${skill.name}` `` could — and roughly fifteen call sites once did exactly that.
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

export function deskPath(principalId: number | null, name: string): string {
    const segment = `/skill/${encodeName(name)}`
    return principalId === null ? segment : `/p/${principalId}${segment}`
}

export function libraryPath(principalId: number | null): string {
    return principalId === null ? '/library' : `/p/${principalId}/library`
}

/** The read-only viewer. Scoped too: a link without a principal would fork the Duplicate onto
 *  whatever the next load defaulted to. */
export function viewerPath(principalId: number | null, name: string): string {
    const segment = `/library/${encodeName(name)}`
    return principalId === null ? segment : `/p/${principalId}${segment}`
}
