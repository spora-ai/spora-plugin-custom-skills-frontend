/**
 * Pure display/derivation helpers for the skills panel.
 *
 * Kept out of the store and the components so the awkward bits — which
 * validator `path` maps to which input, what "last edited" means when
 * an agent rewrote the skill, what to call a forked skill — are tested
 * once against plain values instead of through a mounted component.
 */
import type { CustomSkillResource, SkillValidationEntry } from '../types'

/**
 * Form fields the editor renders, in DOM order. Also the set of
 * frontmatter keys a `SkillValidator` finding can be anchored to.
 */
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
 * Map a validator `path` onto an editor field.
 *
 * The validator reads the raw frontmatter, where the key is spelled
 * `allowed-tools`; the API field and the input's model are
 * `allowed_tools`. Anything unrecognised (e.g. a `metadata` finding)
 * returns `null` so the caller routes it to the banner instead of
 * guessing a field.
 */
export function fieldForPath(path: string | undefined | null): SkillField | null {
    if (typeof path !== 'string' || path === '') return null
    const normalized = path.trim().toLowerCase().replace(/-/g, '_')
    return FIELD_SET.has(normalized) ? (normalized as SkillField) : null
}

/** Findings anchored to `field`, in validator order. */
export function errorsForField(
    entries: SkillValidationEntry[],
    field: SkillField,
): SkillValidationEntry[] {
    return entries.filter((e) => e.severity === 'error' && fieldForPath(e.path) === field)
}

/**
 * Errors that no field claims. These still have to reach the operator
 * somewhere, so the editor shows them in the same banner as the
 * warnings rather than dropping them.
 */
export function unattachedErrors(entries: SkillValidationEntry[]): SkillValidationEntry[] {
    return entries.filter((e) => e.severity === 'error' && fieldForPath(e.path) === null)
}

/**
 * `HH:MM` out of a `YYYY-MM-DD HH:MM:SS` server timestamp.
 *
 * Deliberately a substring slice, not `new Date(...)`: the contract
 * sends the server's own wall-clock with no timezone, and the browser
 * would re-interpret it in the operator's locale offset, shifting the
 * displayed time by hours.
 */
export function clockTime(updatedAt: string): string {
    const match = /\d{2}:\d{2}/.exec(updatedAt)
    return match ? match[0] : ''
}

/**
 * "Last edited by agent · 14:02" / "Last edited by you · 14:02".
 *
 * `provenance` says *how* the last write happened; `updated_by_user_id`
 * disambiguates the `human` case — a human-provenance write made by
 * someone other than the creator (a teammate, or the operator on a
 * shared principal) is attributed to them rather than to "you".
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
 * Name for a fork of `sourceName` that doesn't collide with anything in
 * `taken`. The shipped slug itself is reserved server-side (409
 * `SKILL_NAME_RESERVED`), so the suffix is always appended — even when
 * the plain name looks free.
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

/** Human-readable byte count for the file manifest. */
export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
