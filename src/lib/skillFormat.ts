/**
 * Pure display/derivation helpers, kept out of the store and components so the
 * awkward derivations (validator `path` → input, "last edited" after an agent
 * rewrite, fork naming) are tested against plain values.
 */
import type { Principal } from '../api/principals'
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

/** `CustomSkillLimits::SKILLS_PER_PRINCIPAL` — 422 `SKILL_LIMIT_REACHED`. */
export const SKILL_LIMIT = 25

/**
 * `CustomSkillProvider::SOURCE` — the `source` this plugin's own skills carry in
 * core's `GET /api/v1/skills` listing.
 *
 * That listing is the union over every principal the caller can see, so it comes
 * back holding this plugin's principal-scoped skills alongside the host's shipped
 * ones. A shipped skill is global and has no principal row, so anything from this
 * source in that response is somebody's *own* skill rather than a catalogue entry
 * — which makes it the one signal that separates the two.
 */
export const CUSTOM_SKILLS_SOURCE = 'custom-skills'

/**
 * `SkillProviderInterface::MAX_FILE_BYTES`, restated only for the desk's size
 * readout. A 50 KB file is a 413 `FILE_TOO_LARGE` on read and a 422 on write, so
 * the ceiling is worth showing while there is still room to get under it.
 */
export const MAX_FILE_BYTES = 50_000

/**
 * The server's slug rule, mirrored from `SkillValidator::NAME_PATTERN`
 * (spora-core `app/Skills/SkillValidator.php:29`): 1–64 characters of lowercase
 * alphanumerics and single hyphens, no leading or trailing hyphen. Checked as the
 * operator types because a create rejected for its *name* is otherwise found out
 * about after the body has been written.
 */
const SKILL_NAME_PATTERN = /^(?![a-z0-9-]*--)[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/

export function isValidSkillName(name: string): boolean {
    return SKILL_NAME_PATTERN.test(name)
}

/**
 * Which of the two 409s a name would earn. Both name sets are already in the
 * store, so the collision is knowable before the POST rather than after it.
 */
export type SkillNameConflict = 'own' | 'shipped' | null

export function skillNameConflict(
    name: string,
    own: ReadonlySet<string>,
    shipped: ReadonlySet<string>,
): SkillNameConflict {
    if (own.has(name)) return 'own'
    if (shipped.has(name)) return 'shipped'
    return null
}

const SKILL_OUTLINE = `# %TITLE%

## When to use this

Describe the situation that should make an agent reach for this skill.

## Instructions

1. The first thing to do.
2. The next thing.

## Never

What this skill must not do, however the request is phrased.
`

/**
 * The body every new skill is created with. A skill file that opens empty reads
 * as "nothing here", and the outline is three headings of deletable text to argue
 * with rather than a blank textarea.
 */
export function starterBody(name: string): string {
    const words = name.split('-').filter((part) => part !== '')
    const title = words.length === 0
        ? name
        : words.join(' ').replace(/^./, (first) => first.toUpperCase())
    return SKILL_OUTLINE.replace('%TITLE%', title)
}

/** UTF-8 byte length, which is what both the cap and the contract count. */
export function byteSize(text: string): number {
    return new TextEncoder().encode(text).length
}

export function lineCount(text: string): number {
    return text === '' ? 0 : text.split('\n').length
}

const DAY_MS = 86_400_000
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The contract sends the server's own wall clock with no timezone, so the
 * timestamp is read as UTC and `now` is shifted by the operator's own offset into
 * that same frame — a single-host deployment is exact, and a server in another
 * zone can only be wrong about which *day* a change landed on.
 */
function parseServerStamp(value: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value)
    if (!match) return null
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]))
}

/** `now` expressed on the server's wall clock rather than the browser's. */
function inServerFrame(now: number): number {
    return now - new Date(now).getTimezoneOffset() * 60_000
}

/**
 * How a row says when it last changed: the time today, a weekday this week, a
 * date beyond that. `now` is a parameter so the boundary cases are testable
 * rather than dependent on the day the suite runs.
 */
export function updatedLabel(updatedAt: string, now: number = Date.now()): string {
    const stamp = parseServerStamp(updatedAt)
    if (stamp === null) return ''
    const elapsed = inServerFrame(now) - stamp
    if (elapsed < DAY_MS) return clockTime(updatedAt)
    if (elapsed < 7 * DAY_MS) return WEEKDAYS[new Date(stamp).getUTCDay()] ?? ''
    const date = new Date(stamp)
    const label = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
    return date.getUTCFullYear() === new Date(inServerFrame(now)).getUTCFullYear()
        ? label
        : `${label} ${date.getUTCFullYear()}`
}

/**
 * Who the skills on screen belong to, in the page's own words. The two branches
 * differ because the contract does: a user-principal's skills are private, a
 * group's are readable by any member and writable only by an owner or admin.
 */
export function principalScopeBlurb(principal: Principal | null): string {
    if (principal === null) return 'No principal is selected.'
    return principal.type === 'user'
        ? 'Your personal skills. Only you can see and edit these.'
        : `Skills owned by ${principal.name}. Everyone in the group can read them; writing needs to be an owner or an admin.`
}

export const HOME_SORT_OPTIONS = [
    { value: 'updated', label: 'Recently updated' },
    { value: 'created', label: 'Recently created' },
    { value: 'name-asc', label: 'Name (A–Z)' },
    { value: 'name-desc', label: 'Name (Z–A)' },
] as const

export type SkillSort = (typeof HOME_SORT_OPTIONS)[number]['value']
export type NameSort = 'name-asc' | 'name-desc'

/**
 * "Recently used" is deliberately not offered: nothing records a skill's last
 * invocation, and a sort that silently returns the wrong order is worse than no
 * sort. The timestamps compare as strings because the contract's
 * `YYYY-MM-DD HH:MM:SS` is already in ascending order.
 */
export function sortSkills(skills: readonly CustomSkillResource[], sort: SkillSort): CustomSkillResource[] {
    const next = [...skills]
    switch (sort) {
        case 'updated':
            return next.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        case 'created':
            return next.sort((a, b) => b.created_at.localeCompare(a.created_at))
        case 'name-desc':
            return next.sort((a, b) => b.name.localeCompare(a.name))
        case 'name-asc':
            return next.sort((a, b) => a.name.localeCompare(b.name))
    }
}

/** The catalogue summary carries no timestamps, so only the name orders are offered. */
export const CATALOGUE_SORT_OPTIONS = [
    { value: 'name-asc', label: 'Name (A–Z)' },
    { value: 'name-desc', label: 'Name (Z–A)' },
] as const

export function sortByName<T extends { name: string }>(items: readonly T[], sort: NameSort): T[] {
    return [...items].sort((a, b) => (sort === 'name-asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)))
}

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

/**
 * Whether a path is markdown, and therefore gets `md-editor-v3`.
 *
 * The contract puts no restriction on what a sidecar may be — the validator has
 * no per-file rule and the writer only caps bytes — so `examples/data.json` and
 * `scripts/build.py` are legitimate. A markdown editor is wrong for them: the
 * toolbar would offer bold and task lists for a JSON document, and the preview
 * pane would render the file as prose.
 */
export function isMarkdownPath(path: string): boolean {
    return path.toLowerCase().endsWith('.md')
}

/**
 * A readable name for a non-markdown file, for the footer.
 *
 * The extension is the only thing the panel knows about it — there is no
 * language negotiation, and guessing one from a three-letter extension would be
 * a lie more often than not.
 */
export function fileKind(path: string): string {
    if (isMarkdownPath(path)) return 'Markdown'
    const extension = path.slice(path.lastIndexOf('.') + 1)
    return extension === path || extension === '' ? 'Text' : extension.toUpperCase()
}

/**
 * How the read-only viewer renders a file.
 *
 * The viewer used to branch on `isMarkdownPath` alone, so every other format fell
 * through to the source editor and a JSON file was shown as unformatted text. That
 * reads as "not previewable" even though the panel can read it fine.
 *
 * `binary` is decided from the content rather than the extension, because an
 * extension says what a file is meant to be and the bytes say what it is: a `.txt`
 * that is actually a PDF is the case a name-based rule gets wrong.
 */
export type PreviewMode = 'markdown' | 'formatted' | 'source' | 'binary'

/** Extensions worth reformatting rather than showing verbatim. */
const JSON_EXTENSIONS = new Set(['json', 'jsonc'])

/**
 * A NUL byte, or a run of control characters with no whitespace, is what a binary
 * blob looks like once it has been through a text field. One NUL is decisive; the
 * ratio catches the rest without a false positive on, say, a Latin-1 CSV.
 */
export function looksBinary(text: string): boolean {
    if (text.includes('\u0000')) return true
    const sample = text.slice(0, 4096)
    if (sample === '') return false

    let control = 0
    for (const character of sample) {
        // `for…of` yields whole code points, so this is the character's own value and
        // a surrogate pair is one iteration — which is what we want, since neither
        // half of one is a control character.
        const code = character.codePointAt(0) ?? 0
        // Tab, newline and carriage return are whitespace, not control noise.
        if (code < 32 && code !== 9 && code !== 10 && code !== 13) control += 1
    }

    return control / sample.length > 0.05
}

/**
 * What to render for a file's contents, or `null` when there are none.
 *
 * `formatted` covers JSON only. Pretty-printing YAML or TOML would need a parser,
 * and pulling one in to reindent a read-only view is a dependency the panel does not
 * otherwise have; the language mode already highlights them, which is the part a
 * reader is actually missing.
 */
export function previewModeFor(path: string, contents: string): PreviewMode {
    if (looksBinary(contents)) return 'binary'
    if (isMarkdownPath(path)) return 'markdown'

    const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
    return JSON_EXTENSIONS.has(extension) ? 'formatted' : 'source'
}

/**
 * JSON indented for reading, or `null` when it does not parse.
 *
 * `null` rather than the input unchanged, so a malformed file is shown as written
 * instead of being silently presented as if the reformatting had succeeded — a
 * half-written config is exactly the thing an operator opens this panel to check.
 */
export function formatJsonForPreview(contents: string): string | null {
    try {
        const parsed: unknown = JSON.parse(contents)
        return JSON.stringify(parsed, null, 2)
    } catch {
        return null
    }
}

/** A node in the file rail: a folder has children, a file does not. */
export interface FileTreeNode {
    /** The segment shown in the rail — a folder name or a file's basename. */
    name: string
    /** The full path, which is the file's identity. Folders carry their prefix. */
    path: string
    children: FileTreeNode[]
}

/**
 * The directories the Agent Skills spec names, offered when a file is created.
 *
 * The spec calls these recommendations rather than rules — "A skill directory may
 * contain any files and directories beyond the required `SKILL.md`" — but an
 * operator who is not writing a skill by hand every day will otherwise invent
 * `docs/`, `doc/`, `resources/` and `files/` for the same thing, and a skill
 * that is read by an agent it does not know is easier to follow if it uses the
 * names the ecosystem already agrees on. See
 * https://agentskills.io/specification#optional-directories.
 */
export const CONVENTIONAL_SKILL_FOLDERS = ['references', 'scripts', 'assets'] as const

/**
 * The one path a sidecar may not take.
 *
 * `SKILL.md` is synthesised on read from the skill's own columns — the body lives
 * in `custom_skills.body`, not in `files` — and `CustomSkillWriter` rejects a
 * `files` row under this name as an unwritable second copy. So it is reserved, and
 * the dialog has to say so rather than let the save fail.
 */
export const SKILL_ENTRY_FILE = 'SKILL.md'

/**
 * Leading and trailing slashes are a display habit, not a path.
 *
 * Written as a scan rather than two anchored regexes: the whole string is at most
 * a folder path, and a quantifier on an unbounded run of `/` is the shape of
 * expression that reads as linear and is not.
 */
function trimSlashes(folder: string): string {
    let start = 0
    let end = folder.length
    while (start < end && folder[start] === '/') start += 1
    while (end > start && folder[end - 1] === '/') end -= 1
    return folder.slice(start, end)
}

/**
 * The full path a file would be stored under, from the folder chosen in the
 * dialog and the name typed into it. An empty folder means the skill root, which
 * is where a sidecar with no directory lives.
 */
export function joinFilePath(folder: string, name: string): string {
    const trimmed = trimSlashes(folder)
    return trimmed === '' ? name : `${trimmed}/${name}`
}

/** Why a path cannot be used, or `null` when it can. */
export type FileNameProblem =
    | 'empty'
    | 'has-separator'
    | 'traversal'
    | 'backslash'
    | 'control'
    | 'padded'
    | 'bad-folder'
    | 'reserved'
    | 'duplicate'

const PROBLEM_TEXT: Record<FileNameProblem, string> = {
    empty: 'Name the file.',
    'has-separator': 'Put the folder in the folder field — the name cannot contain “/”.',
    traversal: '“.” and “..” are not file names.',
    backslash: 'Use a forward slash between folders, not a backslash.',
    control: 'That name contains characters a file cannot have.',
    padded: 'Remove the leading or trailing space.',
    'bad-folder': 'That folder cannot be used — try a plain name like “references”.',
    reserved: `${SKILL_ENTRY_FILE} is the skill itself and always exists.`,
    duplicate: 'A file with that path already exists.',
}

/** The characters a stored path may not contain, per the server's own rule. */
// eslint-disable-next-line no-control-regex -- the same range `isSafePath` rejects.
const CONTROL_CHARACTERS = /[\x00-\x1F\x7F]/

/** A single path segment that is not a real name. */
function isBadSegment(segment: string): boolean {
    return segment === '' || segment === '.' || segment === '..' || CONTROL_CHARACTERS.test(segment)
}

/**
 * Why a file cannot be created or renamed to `name` inside `folder`, or `null`.
 *
 * Mirrors `CustomSkillProvider::isSafePath`, which is the server's rule for a
 * sidecar path: plain relative, no traversal, no backslash, no control
 * characters, no empty segment. Checked here so the dialog can say *why* rather
 * than letting a 422 come back after the fact — the plugin is the only layer that
 * knows the operator's intent, and `files` is written as a whole map, so one
 * rejected path fails the entire save rather than just the new file.
 *
 * The folder is checked with the same rules as the name, because the spec allows
 * "any additional files or directories" and the picker offers a suggestion rather
 * than a closed list: `references/../secrets` is a folder the operator must not be
 * able to create, and a `..` that survives to the server costs a whole save.
 *
 * `selfPath` is the file being renamed, which keeps its own path available to
 * itself: renaming `a.md` to `a.md` is a no-op, not a collision.
 */
export function fileNameProblem(
    name: string,
    folder: string,
    takenPaths: readonly string[],
    selfPath?: string,
): FileNameProblem | null {
    if (name === '') return 'empty'
    if (name !== name.trim()) return 'padded'
    if (name.includes('/')) return 'has-separator'
    if (name.includes('\\')) return 'backslash'
    if (isBadSegment(name)) return CONTROL_CHARACTERS.test(name) ? 'control' : 'traversal'

    // Split after trimming, so `/references/` is one segment while `a//b` keeps
    // the empty one the server rejects. A leading or trailing slash is forgiven
    // because it is a typing habit, not a claim about the path.
    if (folder.includes('\\')) return 'backslash'
    const trimmed = trimSlashes(folder)
    const segments = trimmed === '' ? [] : trimmed.split('/')
    if (segments.some((segment) => isBadSegment(segment) || segment !== segment.trim())) {
        return 'bad-folder'
    }

    const path = joinFilePath(folder, name)
    // Checked before the duplicate scan: the entry file is not in `takenPaths`,
    // because it is not a `files` row, so only this catches it.
    if (path === SKILL_ENTRY_FILE) return 'reserved'
    return takenPaths.includes(path) && path !== selfPath ? 'duplicate' : null
}

export function fileNameProblemText(problem: FileNameProblem): string {
    return PROBLEM_TEXT[problem]
}

/** One choice in the dialog's folder picker. The root is the empty path. */
export interface FileFolderOption {
    value: string
    label: string
}

/**
 * What the folder picker offers: the skill root, every folder that already exists
 * in this skill, and the spec's three conventions.
 *
 * Existing folders come first and are never dropped, because a file that is
 * already two levels deep has to stay reachable — the picker is for where a file
 * goes, and moving it shallower is a move the spec encourages. The conventions
 * are appended only when absent, so a skill that already has `references/` shows
 * one entry, not two.
 */
export function fileFolderOptions(existingFolders: readonly string[]): FileFolderOption[] {
    const options: FileFolderOption[] = [{ value: '', label: 'Skill root' }]

    for (const folder of [...existingFolders].sort((a, b) => a.localeCompare(b, 'en'))) {
        options.push({ value: folder, label: `${folder}/` })
    }

    for (const folder of CONVENTIONAL_SKILL_FOLDERS) {
        if (!existingFolders.includes(folder)) {
            options.push({ value: folder, label: `${folder}/` })
        }
    }

    return options
}

/**
 * A free name to pre-fill the dialog with, so the common case is one keystroke
 * and Enter rather than typing a filename from nothing.
 *
 * Only ever a suggestion: the field is editable, because the whole point of the
 * dialog is that `notes-3.md` is not the answer.
 */
export function suggestFileName(takenPaths: readonly string[]): string {
    let n = takenPaths.length + 1
    while (takenPaths.includes(`notes-${n}.md`)) n += 1
    return `notes-${n}.md`
}

/**
 * The rail's tree, derived from the stored paths.
 *
 * Folders are not stored: the contract's `files` is a flat `path => content` map,
 * so a directory exists exactly as long as a file inside it does and there is
 * nothing to persist for an empty one. Creating `references/api.md` is what makes
 * `references/` exist, which is why this is derived rather than modelled.
 *
 * Folders sort before files at every level, and both sort alphabetically, so the
 * order does not shift as files are added.
 *
 * A node is a folder when it ended up with children, and the walk does not
 * overwrite them. A stored set may legitimately contain both `a` and `a/b` — the
 * contract's path rules forbid neither, and the create dialog can produce it — and
 * a walk that cleared children on the way past a leaf would drop one of the two
 * from the rail, leaving a file the operator can neither see, open nor remove
 * while it is still in the save payload. Folder-ness is decided by the shape the
 * walk leaves behind, so both survive.
 */
export function fileTree(paths: string[]): FileTreeNode[] {
    const root: FileTreeNode = { name: '', path: '', children: [] }

    // Not sorted here. Input order only decides which node object is created
    // first; `order()` below is the single place that decides what order they
    // come out in, so a second sort here was both redundant and a bare
    // code-unit sort that could disagree with it.
    for (const path of paths) {
        const segments = path.split('/').filter((segment) => segment !== '')
        if (segments.length === 0) continue

        let node = root
        let walked = ''
        segments.forEach((segment) => {
            walked = walked === '' ? segment : `${walked}/${segment}`
            let child = node.children.find((candidate) => candidate.name === segment)
            if (!child) {
                child = { name: segment, path: walked, children: [] }
                node.children.push(child)
            }
            node = child
        })
    }

    const order = (nodes: FileTreeNode[]): FileTreeNode[] =>
        [...nodes]
            .sort((a, b) => {
                const folderA = a.children.length > 0 ? 0 : 1
                const folderB = b.children.length > 0 ? 0 : 1
                if (folderA !== folderB) return folderA - folderB
                // An explicit locale, not the ambient one: `localeCompare` with
                // no locale sorts by the *runtime's* collation, so the same file
                // names order differently on two machines and the rail reshuffles
                // between them. `en` is also plain codepoint-ish ordering, which
                // is what a path list wants.
                return a.name.localeCompare(b.name, 'en')
            })
            .map((node) => (node.children.length > 0 ? { ...node, children: order(node.children) } : node))

    return order(root.children)
}

/** Every folder path in a tree, e.g. `['examples', 'examples/invoice']`. */
export function folderPaths(nodes: FileTreeNode[]): string[] {
    return nodes.flatMap((node) =>
        node.children.length > 0 ? [node.path, ...folderPaths(node.children)] : [],
    )
}

/** One row of the rail: a folder, or a file at `depth` levels down. */
export interface FlatRow {
    kind: 'folder' | 'file'
    name: string
    path: string
    depth: number
}

/**
 * The tree as a flat list, skipping the contents of collapsed folders.
 *
 * A flat list rather than a recursive component: the rail is one `v-for`, the
 * indent is a number, and the expand/collapse rule is a filter that can be
 * tested without mounting anything.
 */
export function flattenTree(nodes: FileTreeNode[], collapsed: string[] = []): FlatRow[] {
    const rows: FlatRow[] = []
    const walk = (list: FileTreeNode[], depth: number): void => {
        for (const node of list) {
            if (node.children.length === 0) {
                rows.push({ kind: 'file', name: node.name, path: node.path, depth })
                continue
            }
            const isOpen = !collapsed.includes(node.path)
            rows.push({ kind: 'folder', name: node.name, path: node.path, depth })
            if (isOpen) walk(node.children, depth + 1)
        }
    }
    walk(nodes, 0)

    return rows
}

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * `1 warning` / `2 warnings`, without the ternary.
 *
 * Every caller needed this inside a message that was itself chosen by a ternary,
 * which is two conditionals nested in one expression — and the notices that need
 * it all say the same thing about a count.
 */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : pluralForm}`
}
