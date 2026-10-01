/**
 * Pure display/derivation helpers, kept out of the store and components so the
 * awkward derivations (validator `path` → input, "last edited" after an agent
 * rewrite, fork naming) are tested against plain values.
 */
import type { CustomSkillResource, SkillValidationEntry } from '../types'

/** Also the set of frontmatter keys a `SkillValidator` finding can anchor to. */
export const SKILL_FIELDS = [
    'name',
    'description',
    'license',
    'compatibility',
    'allowed_tools',
    'body',
] as const

export type SkillField = (typeof SKILL_FIELDS)[number]

const FIELD_SET: ReadonlySet<string> = new Set(SKILL_FIELDS)

/**
 * The validator reads raw frontmatter, where the key is `allowed-tools`, while the
 * API field is `allowed_tools`. Anything unrecognised (e.g. a `metadata` finding)
 * returns `null` so the caller routes it to the banner instead of guessing.
 */
export function fieldForPath(path: string | undefined | null): SkillField | null {
    if (typeof path !== 'string' || path === '') return null
    const normalized = path.trim().toLowerCase().replace(/-/g, '_')
    return FIELD_SET.has(normalized) ? (normalized as SkillField) : null
}

export function errorsForField(
    entries: SkillValidationEntry[],
    field: SkillField,
): SkillValidationEntry[] {
    return entries.filter((e) => e.severity === 'error' && fieldForPath(e.path) === field)
}

/** Errors no field claims still have to reach the operator, so the banner shows them. */
export function unattachedErrors(entries: SkillValidationEntry[]): SkillValidationEntry[] {
    return entries.filter((e) => e.severity === 'error' && fieldForPath(e.path) === null)
}

/**
 * Deliberately a substring slice, not `new Date(...)`: the contract sends the
 * server's own wall-clock with no timezone, and the browser would re-interpret
 * it in the operator's locale offset, shifting the time by hours.
 */
export function clockTime(updatedAt: string): string {
    const match = /\d{2}:\d{2}/.exec(updatedAt)
    return match ? match[0] : ''
}

/**
 * `provenance` says *how* the last write happened; `updated_by_user_id`
 * disambiguates the `human` case — a human write by anyone other than the creator
 * (a teammate, or the operator on a shared principal) is attributed to them rather
 * than to "you".
 */
export function lastEditedLabel(
    skill: Pick<CustomSkillResource, 'provenance' | 'updated_by_user_id' | 'created_by_user_id' | 'updated_at'>,
): string {
    const time = clockTime(skill.updated_at)
    const actor =
        skill.provenance === 'agent'
            ? 'Last edited by agent'
            : skill.updated_by_user_id !== skill.created_by_user_id
              ? 'Last edited by a teammate'
              : 'Last edited by you'
    return time === '' ? actor : `${actor} · ${time}`
}

/**
 * The shipped slug is reserved server-side (409 `SKILL_NAME_RESERVED`), so the
 * suffix is appended even when the plain name looks free.
 */
export function forkName(sourceName: string, taken: ReadonlySet<string>): string {
    const base = `${sourceName}-copy`
    if (!taken.has(base)) return base
    let n = 2
    while (taken.has(`${base}-${n}`)) n += 1
    return `${base}-${n}`
}

/** Sidecar files, excluding the synthesised `SKILL.md` entry. */
export function sidecarFiles(skill: CustomSkillResource) {
    return skill.files.filter((f) => f.path !== 'SKILL.md')
}

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
