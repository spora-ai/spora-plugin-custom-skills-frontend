<script setup lang="ts">
/**
 * The desk: one file at a time, with `SKILL.md` always present.
 *
 * The rail cannot be empty. The reserved sidecar path is synthesised on read, so
 * "SKILL.md exists" costs nothing to guarantee and turns the rail from "a list you
 * populate" into "one row you cannot remove" — which is also why a new skill is
 * created with a seeded outline rather than opened blank.
 *
 * **There is no "not saved yet" state.** The contract has no draft: `provenance` +
 * `has_previous` are the whole lifecycle, so the row exists the moment its name is
 * fixed. The pill therefore tracks divergence between the buffer and the stored
 * resource, which is the question the prototype's pill was actually asking.
 *
 * The frontmatter sits above the editor, open, and only while `SKILL.md` is the
 * open file — it is that file's header and nothing else's. It was a closed
 * disclosure above the editor whatever was open, which put the description (the
 * field a skill is matched on, and the only one whose absence is silent) two
 * clicks deep behind a summary.
 */
import { computed, ref, useId, watch } from 'vue'
import { MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import DOMPurify from 'dompurify'
import { ChevronRight, Copy, FileText, Folder, Lock, MoreHorizontal, Pencil, Plus, Save, Trash2 } from 'lucide-vue-next'
import SourceEditor from './SourceEditor.vue'
import FileDialog from './FileDialog.vue'
import {
    errorsForField,
    fileKind,
    fileTree,
    flattenTree,
    folderPaths,
    formatBytes,
    isMarkdownPath,
    SKILL_ENTRY_FILE,
    suggestFileName,
    unattachedErrors,
    updatedLabel,
    byteSize,
    lineCount,
    MAX_FILE_BYTES,
} from '../lib/skillFormat'
import { MARKDOWN_LOCALE } from '../lib/markdownLocale'
import type { CustomSkillResource, SkillValidationEntry, UpdateSkillDto } from '../types'

const METADATA_PLACEHOLDER = '{"tier": "pro"}'

/**
 * Why the name is fixed, and what to do instead. One string so the tooltip and the
 * accessible name cannot drift apart.
 */
const NAME_LOCK_REASON =
    'The name cannot be changed: every agent that allows this skill refers to it by name, '
    + 'so a rename would orphan those entries. Use Duplicate to copy it under a new name, '
    + 'then delete this one.'
const EDITOR_LOCALE = MARKDOWN_LOCALE

/**
 * The toolbar, mirroring `spora-plugin-memories-frontend`'s editor.
 *
 * A skill body is markdown the model reads, so the formatting affordances are
 * the point: task lists and tables are how an operator sketches a protocol, and
 * writing those by hand in a raw textarea is the reason the memories editor
 * uses this component rather than a plain field. `github`, `mermaid` and
 * `formula` are left out for the reason they are left out there — a skill body
 * is prose, not a document set.
 */
type EditorToolbarItem =
    | 'bold' | 'underline' | 'italic' | 'strikeThrough'
    | 'title' | 'sub' | 'sup' | 'quote'
    | 'unorderedList' | 'orderedList' | 'task'
    | 'code' | 'codeRow' | 'link' | 'image' | 'table'
    | '-'

const EDITOR_TOOLBARS: EditorToolbarItem[] = [
    'bold', 'underline', 'italic', 'strikeThrough',
    '-',
    'title', 'sub', 'sup', 'quote',
    '-',
    'unorderedList', 'orderedList', 'task',
    '-',
    'code', 'codeRow', 'link', 'image', 'table',
]

const props = withDefaults(
    defineProps<{
        skill: CustomSkillResource
        saving?: boolean
        validationErrors?: SkillValidationEntry[]
        /** Sidecar contents keyed by path — the manifest knows the files exist. */
        fileContents?: Record<string, string>
        theme?: 'light' | 'dark'
        /** Named in the footer, because "in <principal>" is the desk's scope. */
        principalName?: string
        /**
         * A shipped skill opened on this route. The desk is the writing surface,
         * so a shipped skill has nothing to write to — the host's catalogue
         * endpoint returns file metadata with no per-file read and no write path
         * at all. Rendering it read-only here beats bouncing to the plainer
         * viewer, which is the other place this content is reachable.
         */
        readOnly?: boolean
        /** `core`, a plugin slug, or `project` — shown where the principal goes. */
        shippedSource?: string | null
    }>(),
    {
        saving: false,
        validationErrors: () => [],
        fileContents: () => ({}),
        theme: undefined,
        principalName: '',
        readOnly: false,
        shippedSource: null,
    },
)

const emit = defineEmits<{
    save: [data: UpdateSkillDto]
    delete: [name: string]
    restore: [name: string]
    cancel: []
    loadFiles: [name: string]
    duplicate: [name: string]
}>()

const activePath = ref<string>(SKILL_ENTRY_FILE)
const body = ref('')
const description = ref('')
const license = ref('')
const compatibility = ref('')
const allowedTools = ref('')
const metadataJson = ref('')
const sidecars = ref<Array<{ path: string; content: string }>>([])
const metadataError = ref<string | null>(null)

/**
 * The skill-level menu, which exists so the desk has exactly one delete on
 * screen.
 *
 * Removing a sidecar and deleting the skill were both a bare trash icon about
 * 30 px apart, one in the row with the filename and one in the row below — same
 * icon, same shape, and the difference between them is the whole skill. The
 * sidecar one names the file it removes; this one is behind a menu and says
 * "Delete skill" in words.
 */
const menuOpen = ref(false)

const instanceId = useId()
const idFor = (field: string): string => `${instanceId}-${field}`

function closeMenu(): void {
    menuOpen.value = false
}

/**
 * The rail's tree, and which folders are open.
 *
 * Everything collapses when the file set changes, because a folder that was open
 * may no longer exist and a rail that silently keeps a stale expansion looks
 * like data loss.
 */
const tree = computed(() => fileTree(sidecars.value.map((row) => row.path)))
const folders = computed(() => folderPaths(tree.value))
const collapsed = ref<string[]>([])
const rows = computed(() => flattenTree(tree.value, collapsed.value))

const isCollapsed = (path: string): boolean => collapsed.value.includes(path)

function toggleFolder(path: string): void {
    collapsed.value = isCollapsed(path)
        ? collapsed.value.filter((p) => p !== path)
        : [...collapsed.value, path]
}

/** The folder a new file should land in: the deepest one holding the open file. */
const targetFolder = computed(() => {
    const parent = activePath.value.includes('/')
        ? activePath.value.slice(0, activePath.value.lastIndexOf('/'))
        : ''
    // Only if it is on screen — adding into a collapsed folder the operator
    // cannot see is worse than adding at the root.
    return folders.value.includes(parent) && !isCollapsed(parent) ? parent : ''
})

const activeSidecarIndex = computed(() => sidecars.value.findIndex((row) => row.path === activePath.value))
const activeSidecar = computed(() =>
    activeSidecarIndex.value >= 0 ? sidecars.value[activeSidecarIndex.value] ?? null : null,
)

/** The markdown under the cursor, whichever file is open. */
const activeContent = computed<string>({
    get() {
        if (activePath.value === SKILL_ENTRY_FILE) return body.value
        return activeSidecar.value?.content ?? ''
    },
    set(next: string) {
        if (activePath.value === SKILL_ENTRY_FILE) {
            body.value = next
            return
        }
        const index = activeSidecarIndex.value
        if (index < 0) return
        sidecars.value = sidecars.value.map((row, i) => (i === index ? { ...row, content: next } : row))
    },
})

const totalLines = computed(() => lineCount(activeContent.value))
const totalBytes = computed(() => byteSize(activeContent.value))
const activeIsMarkdown = computed(() => isMarkdownPath(activePath.value))
const showRestore = computed(() => props.skill.has_previous)

/**
 * What "Restore" is about to do, since the label alone was misleading.
 *
 * `CustomSkillWriter::restore()` snapshots the live state before writing the
 * previous one back, so the two versions swap and a second restore returns you
 * where you started. That makes it a toggle over two versions, not a history, and
 * the button said "Restore previous version" as though there were a stack behind
 * it — which is the reading that makes a restore look destructive. It is not: the
 * version you are on is the one that becomes the rollback copy.
 *
 * The snapshot carries the sidecars too, so this restores added, edited and deleted
 * files alike, and the time is what it was captured at, not when it was last edited.
 */
const restoreLabel = computed(() => {
    const when = props.skill.previous_at ? updatedLabel(props.skill.previous_at) : ''
    return when === '' ? 'Restore previous version' : `Restore the version from ${when}`
})

const restoreExplanation = computed(() =>
    `${restoreLabel.value}. This is the only earlier version kept, and restoring swaps the two — `
    + 'restore again to come back to what you have now. Sidecar files are restored with it.',
)

/**
 * Why a shipped sidecar is blank.
 *
 * `SkillController::detail()` returns `files` as `{path, bytes}` metadata and
 * there is no per-file read for a shipped skill — the plugin's own sidecar
 * endpoint is principal-scoped and knows nothing about them. So the rail can
 * list a file it cannot open, and saying so beats an empty editor that looks
 * like a failed load.
 */
const shippedSidecarNote = 'Shipped sidecar contents are not served — only their size is.'

/**
 * How the metadata textarea is derived from a stored skill.
 *
 * Shared by the buffer and the baseline so the two cannot disagree: an empty map
 * is an empty textarea rather than `{}`, which is what an operator would have had
 * to delete to get it back.
 */
function metadataText(metadata: Record<string, unknown>): string {
    return Object.keys(metadata).length > 0 ? JSON.stringify(metadata, null, 2) : ''
}

/**
 * The server's sidecar set, with the contents it holds.
 *
 * `files` on the resource is metadata only — `{path, bytes}`, no body — so a
 * sidecar's contents arrive in a second request after the row is on screen. They
 * are part of what the server holds, so the baseline reads them from the same
 * place the buffer gets them rather than assuming they were empty at load time.
 */
const serverSidecars = computed(() =>
    props.skill.files
        .filter((f) => f.path !== SKILL_ENTRY_FILE)
        .map((f) => ({ path: f.path, content: props.fileContents[f.path] ?? '' })),
)

const draft = computed(() => JSON.stringify({
    description: description.value,
    license: license.value,
    compatibility: compatibility.value,
    allowed_tools: allowedTools.value,
    metadata: metadataJson.value,
    body: body.value,
    files: sidecars.value,
}))

/**
 * What the server holds, as the same shape as {@link draft}.
 *
 * Derived rather than snapshotted at load time, and that is the fix: the previous
 * version captured the buffer's own value on load, which was taken before the
 * sidecar contents arrived. Every skill with a sidecar therefore read as unsaved
 * the moment its contents loaded, and saving did not clear it, because the next
 * load repeated the same early snapshot. A new file is still detected, because a
 * path the server does not list is in the buffer and not here.
 */
const baseline = computed(() => JSON.stringify({
    description: props.skill.description,
    license: props.skill.license ?? '',
    compatibility: props.skill.compatibility ?? '',
    allowed_tools: props.skill.allowed_tools ?? '',
    metadata: metadataText(props.skill.metadata),
    body: props.skill.body,
    files: serverSidecars.value,
}))

const dirty = computed(() => draft.value !== baseline.value)

/** Warnings, plus any error no field claims — both would be invisible otherwise. */
const bannerEntries = computed<SkillValidationEntry[]>(() => [
    ...props.validationErrors.filter((e) => e.severity !== 'error'),
    ...unattachedErrors(props.validationErrors),
    ...props.skill.warnings,
])

function fieldErrors(field: Parameters<typeof errorsForField>[1]) {
    return errorsForField(props.validationErrors, field)
}

/**
 * Refills the buffer from a stored skill.
 *
 * `$keepOpenFile` is what stops a save from closing the file you were editing: a
 * save changes `updated_at`, which re-enters the reload below, and resetting the
 * open file every time meant the desk jumped back to `SKILL.md` under the cursor
 * the moment a save landed. It is honoured only when the open file still exists —
 * a file deleted in the same save has to go somewhere else.
 */
function loadFrom(skill: CustomSkillResource, keepOpenFile: boolean): void {
    const paths = new Set(skill.files.map((f) => f.path))
    if (!keepOpenFile || !paths.has(activePath.value)) {
        activePath.value = SKILL_ENTRY_FILE
    }

    description.value = skill.description
    license.value = skill.license ?? ''
    compatibility.value = skill.compatibility ?? ''
    allowedTools.value = skill.allowed_tools ?? ''
    metadataJson.value = metadataText(skill.metadata)
    body.value = skill.body
    sidecars.value = skill.files
        .filter((f) => f.path !== SKILL_ENTRY_FILE)
        // Contents stay empty here and are filled by the `fileContents` watcher; the
        // dirty baseline is derived from the server's side of the comparison, so it
        // does not matter which lands first.
        .map((f) => ({ path: f.path, content: '' }))
}

/**
 * Declared beside the state it guards, not next to the watcher: `loadFrom` runs
 * from an `immediate` watcher, so a later declaration is a temporal-dead-zone
 * crash on the first render — invisible to a type-checker.
 */
let loadedAt = ''

watch(
    () => props.skill,
    (skill) => {
        // An edit changes `updated_at`; a re-read of the same row does not. Without
        // the guard, a background list refresh would replace the buffer under a
        // half-typed body.
        if (skill.updated_at === loadedAt) return
        // The first load has nothing to keep open; every later one is a save or a
        // deliberate reload, and closing the file being worked on helps nobody.
        const isReload = loadedAt !== ''
        loadedAt = skill.updated_at
        loadFrom(skill, isReload)
        if (skill.files.some((f) => f.path !== SKILL_ENTRY_FILE)) {
            emit('loadFiles', skill.name)
        }
    },
    { immediate: true },
)

/**
 * `immediate` because a sidecar can be open on the first render: the page fills
 * `fileContents` in response to the `loadFiles` above, and without this a
 * container that already had them would be ignored.
 */
watch(
    () => props.fileContents,
    (contents) => {
        if (Object.keys(contents).length === 0) return
        sidecars.value = sidecars.value.map((row) => ({ ...row, content: contents[row.path] ?? row.content }))
    },
    { deep: true, immediate: true },
)

watch(
    () => props.skill,
    () => {
        collapsed.value = []
    },
)

function fileSize(path: string): number {    if (path === SKILL_ENTRY_FILE) return byteSize(body.value)
    return byteSize(sidecars.value.find((row) => row.path === path)?.content ?? '')
}

/**
 * Create and rename both run through the dialog.
 *
 * A file used to be added under an invented name (`notes-4.md`) that could only
 * then be corrected by typing a whole path into the row, and that correction did
 * not work: the rail keys rows on the path, so the first character of a rename
 * re-created the input and took the focus with it. The name and the folder are
 * therefore one decision, made once, where both can be seen.
 */
const fileDialog = ref<{ open: boolean; mode: 'create' | 'rename'; name: string; folder: string; selfPath?: string }>({
    open: false,
    mode: 'create',
    name: '',
    folder: '',
})

const takenPaths = computed(() => sidecars.value.map((row) => row.path))

function openCreateDialog(): void {
    fileDialog.value = {
        open: true,
        mode: 'create',
        name: suggestFileName(takenPaths.value),
        // Where the operator is working, so a file lands next to what they opened.
        folder: targetFolder.value,
    }
}

/** Renaming the open sidecar. Folders in the picker are the file's own ancestors. */
function openRenameDialog(): void {
    const current = activeSidecar.value
    if (current === null) return
    const slash = current.path.lastIndexOf('/')
    fileDialog.value = {
        open: true,
        mode: 'rename',
        name: slash === -1 ? current.path : current.path.slice(slash + 1),
        folder: slash === -1 ? '' : current.path.slice(0, slash),
        selfPath: current.path,
    }
}

function closeFileDialog(): void {
    fileDialog.value = { ...fileDialog.value, open: false }
}

/**
 * Applies a path from the dialog.
 *
 * A rename keeps the content and re-points `activePath` at the new path, because
 * the path is the row's identity: leaving it behind would blank the open file.
 */
function applyFilePath(path: string): void {
    if (fileDialog.value.mode === 'create') {
        sidecars.value = [...sidecars.value, { path, content: '' }]
    } else {
        const index = activeSidecarIndex.value
        if (index < 0) return
        sidecars.value = sidecars.value.map((row, i) => (i === index ? { ...row, path } : row))
    }
    activePath.value = path
    closeFileDialog()
}

function removeActiveSidecar(): void {
    const index = activeSidecarIndex.value
    if (index < 0) return
    sidecars.value = sidecars.value.filter((_, i) => i !== index)
    activePath.value = SKILL_ENTRY_FILE
}

function parseMetadata(): { value: Record<string, unknown> } | { error: string } {
    const raw = metadataJson.value.trim()
    if (raw === '') return { value: {} }
    try {
        const parsed: unknown = JSON.parse(raw)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return { error: 'Metadata must be a JSON object, e.g. {"tier": "pro"}.' }
        }
        return { value: parsed as Record<string, unknown> }
    } catch {
        return { error: 'Metadata is not valid JSON.' }
    }
}

function handleSubmit(): void {
    metadataError.value = null
    const metadata = parseMetadata()
    if ('error' in metadata) {
        metadataError.value = metadata.error
        return
    }

    // `files` fully replaces the sidecar set, so a blank path is dropped rather
    // than sent as a path the server rejects.
    const files: Record<string, string> = {}
    for (const row of sidecars.value) {
        const path = row.path.trim()
        if (path === '' || path === SKILL_ENTRY_FILE) continue
        files[path] = row.content
    }

    const empty = (value: string): string | null => (value.trim() === '' ? null : value.trim())
    emit('save', {
        description: description.value.trim(),
        body: body.value,
        license: empty(license.value),
        compatibility: empty(compatibility.value),
        allowed_tools: empty(allowedTools.value),
        metadata: metadata.value,
        files,
    })
}
</script>

<template>
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-background md:flex-row" data-test="skill-desk">
        <aside
            class="flex w-56 shrink-0 flex-col border-b border-border bg-muted/30 md:border-b-0 md:border-r"
            data-test="file-rail"
        >
            <div class="flex items-center justify-between px-3 py-2.5">
                <h2 class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Files</h2>
                <button
                    v-if="!readOnly"
                    type="button"
                    class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                    title="Add a file"
                    aria-label="Add a file"
                    data-test="add-file"
                    @click="openCreateDialog"
                >
                    <Plus class="h-3.5 w-3.5" />
                </button>
            </div>

            <nav class="px-1.5 pb-3 text-sm">
                <!-- The one row that cannot be removed: the contract synthesises it. -->
                <button
                    type="button"
                    class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[13px] transition-colors hover:bg-background"
                    :class="activePath === SKILL_ENTRY_FILE ? 'bg-background shadow-sm ring-1 ring-border' : ''"
                    data-test="rail-entry"
                    @click="activePath = SKILL_ENTRY_FILE"
                >
                    <FileText class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span class="truncate">{{ SKILL_ENTRY_FILE }}</span>
                    <span class="ml-auto shrink-0 text-[10px] text-muted-foreground">
                        {{ formatBytes(fileSize(SKILL_ENTRY_FILE)) }}
                    </span>
                </button>

                <template v-for="row in rows" :key="row.path">
                    <button
                        v-if="row.kind === 'folder'"
                        type="button"
                        class="flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left font-mono text-[13px] text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                        :style="{ paddingLeft: `${0.5 + row.depth * 0.75}rem` }"
                        :aria-expanded="!isCollapsed(row.path)"
                        :data-test="`rail-folder-${row.path}`"
                        @click="toggleFolder(row.path)"
                    >
                        <ChevronRight
                            class="h-3 w-3 shrink-0 transition-transform"
                            :class="isCollapsed(row.path) ? '' : 'rotate-90'"
                        />
                        <Folder class="h-3.5 w-3.5 shrink-0" />
                        <span class="truncate">{{ row.name }}</span>
                    </button>

                    <!--
                        A wrapper rather than a nested button: the row selects the file
                        and the pencil renames it, and a `<button>` inside a `<button>`
                        is invalid HTML that also swallows the inner click in some
                        browsers. Only the open row offers the pencil, so the rail
                        carries one affordance at a time.
                    -->
                    <div
                        v-else
                        class="group flex items-center gap-0.5"
                        :style="row.depth > 0 ? { paddingLeft: `${1.25 + (row.depth - 1) * 0.75}rem` } : undefined"
                    >
                        <button
                            type="button"
                            class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[13px] transition-colors hover:bg-background"
                            :class="activePath === row.path ? 'bg-background shadow-sm ring-1 ring-border' : ''"
                            :title="row.path"
                            :data-test="`rail-file-${row.path}`"
                            @click="activePath = row.path"
                        >
                            <FileText class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span class="min-w-0 flex-1 truncate">{{ row.name }}</span>
                            <span class="shrink-0 text-[10px] text-muted-foreground">
                                {{ formatBytes(fileSize(row.path)) }}
                            </span>
                        </button>
                        <button
                            v-if="activePath === row.path"
                            type="button"
                            class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            :aria-label="`Rename ${row.path}`"
                            title="Rename or move"
                            data-test="rename-file"
                            @click.stop="openRenameDialog"
                        >
                            <Pencil class="h-3 w-3" />
                        </button>
                    </div>
                </template>
            </nav>

            <!-- Why the rail cannot be empty, stated once, where someone who just
                 looked for a delete on SKILL.md is already looking. -->
            <div class="mt-auto border-t border-border p-3">
                <p class="text-[11px] leading-snug text-muted-foreground">
                    Every skill has a <span class="font-mono text-foreground">SKILL.md</span>. Add
                    sidecars for references and examples.
                </p>
            </div>
        </aside>

        <div class="flex min-h-0 flex-1 flex-col">
            <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
                <h3 class="font-mono text-sm font-semibold" data-test="desk-title">{{ skill.name }}</h3>
                <!--
                    The name is the skill's identity, so it is not editable here, and
                    saying only "cannot be changed" leaves the operator looking for the
                    way round it. `CustomSkillWriter::update()` refuses the same way:
                    every agent that allows this skill refers to it by name, so a
                    rename would orphan those entries. Duplicate carries them across.
                    The `aria-label` carries the same text as the `title` because a
                    tooltip alone is hover-only, which a pointer and a keyboard do
                    not have in common.
                -->
                <Lock
                    class="h-3.5 w-3.5 text-muted-foreground"
                    :title="NAME_LOCK_REASON"
                    :aria-label="NAME_LOCK_REASON"
                    role="img"
                    data-test="desk-name-lock"
                />
                <span
                    class="ml-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset"
                    :class="readOnly
                        ? 'bg-muted text-muted-foreground ring-border'
                        : (dirty
                            ? 'bg-amber-500/15 text-amber-700 ring-amber-500/25'
                            : 'bg-muted text-muted-foreground ring-border')"
                    data-test="desk-state"
                >
                    {{ readOnly ? 'read-only' : (dirty ? 'unsaved changes' : 'saved') }}
                </span>

                <div class="ml-auto flex items-center gap-1.5">
                    <button
                        v-if="readOnly"
                        type="button"
                        class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium transition-colors hover:bg-muted"
                        data-test="desk-duplicate"
                        @click="emit('duplicate', skill.name)"
                    >
                        <Copy class="h-3.5 w-3.5" />
                        Duplicate
                    </button>
                    <template v-else>
                        <button
                            v-if="showRestore"
                            type="button"
                            :disabled="saving"
                            :title="restoreExplanation"
                            :aria-label="restoreExplanation"
                            class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
                            data-test="desk-restore"
                            @click="emit('restore', skill.name)"
                        >
                            {{ restoreLabel }}
                        </button>
                        <button
                            type="button"
                            class="inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            data-test="desk-cancel"
                            @click="emit('cancel')"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            :disabled="saving || !dirty"
                            class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                            data-test="desk-save"
                            @click="handleSubmit"
                        >
                            <Save class="h-3.5 w-3.5" />
                            {{ saving ? 'Saving…' : 'Save skill' }}
                        </button>
                        <div class="relative shrink-0">
                            <button
                                v-if="menuOpen"
                                type="button"
                                class="fixed inset-0 z-10 cursor-default"
                                aria-label="Close the menu"
                                data-test="desk-menu-backdrop"
                                @click="closeMenu"
                            />
                            <button
                                type="button"
                                :disabled="saving"
                                class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                                aria-label="More actions for this skill"
                                data-test="desk-menu-trigger"
                                @click="menuOpen = !menuOpen"
                            >
                                <MoreHorizontal class="h-3.5 w-3.5" />
                            </button>

                            <div
                                v-if="menuOpen"
                                class="absolute right-0 top-9 z-20 w-56 overflow-hidden rounded-xl border border-border bg-card text-left shadow-lg"
                                data-test="desk-menu"
                            >
                                <button
                                    type="button"
                                    class="flex w-full items-center gap-2 px-3 py-2 text-xs text-destructive transition-colors hover:bg-destructive/10"
                                    data-test="desk-delete"
                                    @click="closeMenu(); emit('delete', skill.name)"
                                >
                                    <Trash2 class="h-3.5 w-3.5" />
                                    Delete skill
                                </button>
                            </div>
                        </div>
                    </template>
                </div>
            </div>

            <div
                v-if="activeSidecar"
                class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2"
            >
                <button
                    v-if="!readOnly"
                    type="button"
                    class="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium transition-colors hover:bg-muted"
                    data-test="remove-sidecar"
                    @click="removeActiveSidecar"
                >
                    <Trash2 class="h-3.5 w-3.5" />
                    Remove {{ activeSidecar.path }}
                </button>
                <span v-else class="ml-auto text-[11px] text-muted-foreground" data-test="sidecar-unavailable">
                    {{ shippedSidecarNote }}
                </span>
            </div>

            <!-- A shipped skill has no write path, so the frontmatter is shown as
                 the specification it is rather than as a form. -->
            <p
                v-if="readOnly"
                class="shrink-0 border-b border-border bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground"
                data-test="desk-readonly-note"
            >
                Shipped with Spora{{ shippedSource ? ` (${shippedSource})` : '' }}. It lives in the
                installation, not on a principal, so it cannot be edited here — duplicate it to make
                your own.
            </p>

            <!--
                The frontmatter belongs to SKILL.md and to nothing else, so it is shown
                only while that file is open, and nothing is said when it is not: a
                sidecar has no frontmatter to explain, and a message naming a file the
                operator can rename from the rail is worse than no message.

                Collapsible, and open. The collapsing is worth having — the body is
                what most visits are for — but it was closed by default, which put the
                description two clicks deep. The description is the field a skill is
                matched on and the only one whose absence is silent, so it starts on
                screen and can be folded away by whoever wants the room.
            -->
            <details
                v-if="activePath === SKILL_ENTRY_FILE"
                open
                class="group shrink-0 border-b border-border bg-muted/20"
                data-test="frontmatter"
            >
                <summary
                    class="flex cursor-pointer list-none items-center gap-2 px-4 py-2 text-xs font-semibold transition-colors hover:text-foreground"
                    data-test="frontmatter-toggle"
                >
                    <ChevronDown class="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
                    SKILL.md frontmatter
                    <span class="font-normal text-muted-foreground">
                        the fields an agent matches and restricts itself by
                    </span>
                </summary>

                <div class="space-y-3 border-t border-border px-4 py-3">
                    <div class="space-y-3">
                        <div>
                            <label :for="idFor('description')" class="mb-1.5 block text-xs font-medium">
                                Description <span class="text-destructive">*</span>
                            </label>
                            <!--
                            A textarea, not an input: the contract allows 1024
                            characters and the spec asks for both what the skill does
                            and when to use it, which does not fit on one line and
                            wrapped invisibly off the right edge of an input.
                        -->
                            <textarea
                                :id="idFor('description')"
                                v-model="description"
                                rows="3"
                                maxlength="1024"
                                :readonly="readOnly"
                                class="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed"
                                :aria-invalid="fieldErrors('description').length > 0"
                                data-test="field-description"
                            />
                            <p class="mt-1 text-[11px] text-muted-foreground">
                                What the skill does and when to use it — this is the text a matching
                                system reads to decide whether the skill applies.
                                <span class="tabular-nums">{{ description.length }}/1024</span>
                            </p>
                            <ul
                                v-for="entry in fieldErrors('description')"
                                :key="entry.code + entry.message"
                                class="mt-1 text-xs text-destructive"
                                data-test="field-error"
                            >
                                {{ entry.message }}
                            </ul>
                        </div>

                        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                                <label :for="idFor('license')" class="mb-1.5 block text-xs font-medium">License</label>
                                <input
                                    :id="idFor('license')"
                                    v-model="license"
                                    type="text"
                                    placeholder="MIT"
                                    :readonly="readOnly"
                                    class="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                                    :aria-invalid="fieldErrors('license').length > 0"
                                    data-test="field-license"
                                />
                            </div>
                            <div>
                                <label :for="idFor('compatibility')" class="mb-1.5 block text-xs font-medium">
                                    Compatibility
                                </label>
                                <input
                                    :id="idFor('compatibility')"
                                    v-model="compatibility"
                                    type="text"
                                    placeholder="spora>=0.28"
                                    :readonly="readOnly"
                                    class="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                                    :aria-invalid="fieldErrors('compatibility').length > 0"
                                    data-test="field-compatibility"
                                />
                            </div>
                        </div>

                        <div>
                            <label :for="idFor('allowed-tools')" class="mb-1.5 block text-xs font-medium">
                                Allowed tools <span class="text-muted-foreground">(comma separated)</span>
                            </label>
                            <input
                                :id="idFor('allowed-tools')"
                                v-model="allowedTools"
                                type="text"
                                placeholder="read_email, send_email"
                                :readonly="readOnly"
                                class="h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm"
                                :aria-invalid="fieldErrors('allowed_tools').length > 0"
                                data-test="field-allowed-tools"
                            />
                        </div>

                        <div>
                            <label :for="idFor('metadata')" class="mb-1.5 block text-xs font-medium">
                                Metadata <span class="text-muted-foreground">(JSON object)</span>
                            </label>
                            <textarea
                                :id="idFor('metadata')"
                                v-model="metadataJson"
                                rows="2"
                                :readonly="readOnly"
                                :placeholder="METADATA_PLACEHOLDER"
                                class="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs"
                                :aria-invalid="metadataError !== null"
                                data-test="field-metadata"
                            />
                        </div>
                    </div>
                </div>
            </details>

            <output
                v-if="bannerEntries.length > 0"
                class="block shrink-0 rounded-b-lg bg-amber-500/10 px-4 py-2 text-[11px] text-amber-800 dark:text-amber-200"
                data-test="validation-banner"
            >
                <span
                    v-for="entry in bannerEntries"
                    :key="`${entry.code}-${entry.path ?? ''}-${entry.message}`"
                    class="mr-3 inline-block"
                    data-test="banner-entry"
                >
                    <code class="font-mono font-medium">{{ entry.code }}</code>
                    <span v-if="entry.path"> ({{ entry.path }})</span>
                    — {{ entry.message }}
                </span>
            </output>

            <!--
                One pane, and the editor owns its own preview.

                The Write / Split / Preview buttons were a second, plainer copy of a
                control `MdEditor` already ships in its toolbar — so the panel had two
                ways to say the same thing, and the outer one could disagree with the
                inner one about what was on screen. `preview` is on, which gives the
                split view and the toggle in the editor's own chrome, next to the
                formatting buttons that affect what it renders.
            -->
            <div class="min-h-0 flex-1 overflow-hidden">
                <div :aria-label="`${activePath} source`" data-test="desk-source">
                    <MdEditor
                        v-if="activeIsMarkdown"
                        :id="idFor('editor')"
                        :model-value="activeContent"
                        :theme="theme ?? 'light'"
                        :language="EDITOR_LOCALE"
                        :toolbars="readOnly ? [] : EDITOR_TOOLBARS"
                        :preview="true"
                        :read-only="readOnly"
                        :sanitize="DOMPurify.sanitize"
                        :max-length="MAX_FILE_BYTES"
                        class="h-full min-h-[18rem]"
                        data-test="desk-editor"
                        @update:model-value="activeContent = $event"
                    />
                    <!--
                        A markdown editor for a `.json` or `.py` sidecar would offer
                        bold and task lists, and its preview would render the file as
                        prose. The contract allows any file type, so anything that is
                        not markdown gets CodeMirror with the mode its extension
                        implies — and no preview, because there is nothing to render.
                    -->
                    <SourceEditor
                        v-else
                        :model-value="activeContent"
                        :path="activePath"
                        :read-only="readOnly"
                        @update:model-value="activeContent = $event"
                    />
                </div>
            </div>

            <!--
                The separate preview pane is gone with the mode buttons. It also used
                to render a JSON sidecar as prose in preview-only mode, which is the
                thing the editor above exists to avoid.
            -->

            <footer
                class="flex shrink-0 flex-wrap items-center gap-3 border-t border-border bg-muted/30 px-4 py-1.5 text-[11px] text-muted-foreground"
                data-test="desk-footer"
            >
                <span class="font-mono" data-test="desk-footer-file">{{ activePath }}</span>
                <span>UTF-8</span>
                <span v-if="activeIsMarkdown">Markdown</span>
                <span v-else>{{ fileKind(activePath) }}</span>
                <!--
                    Below the editor rather than above it. The cap is per file and
                    only matters while writing, and a size readout pinned above the
                    body pushed the thing being written down the screen.
                -->
                <span class="text-muted-foreground" data-test="desk-size">
                    {{ totalLines }} lines · {{ formatBytes(totalBytes) }}
                    <span class="text-muted-foreground/60">
                        / {{ MAX_FILE_BYTES / 1000 }} KB per file
                    </span>
                </span>
                <!-- The rail is hidden below `md`; without this a narrow window would
                     have no way to reach a sidecar at all. -->
                <select
                    v-model="activePath"
                    aria-label="File"
                    class="h-6 min-w-0 rounded border border-border bg-background px-1.5 font-mono text-[11px] md:hidden"
                    data-test="file-select"
                >
                    <option :value="SKILL_ENTRY_FILE">SKILL.md</option>
                    <option v-for="row in sidecars" :key="row.path" :value="row.path">{{ row.path }}</option>
                </select>
                <span class="ml-auto">
                    <template v-if="readOnly">
                        shipped<span v-if="shippedSource"> · {{ shippedSource }}</span>
                    </template>
                    <template v-else>
                        in <span class="font-medium text-foreground">{{ principalName || 'this principal' }}</span>
                    </template>
                </span>
            </footer>
        </div>

        <!--
            Not rendered at all for a shipped skill: the desk is read-only there, so
            offering a way to add or rename a file would be offering to write.
        -->
        <FileDialog
            v-if="!readOnly"
            :open="fileDialog.open"
            :mode="fileDialog.mode"
            :initial-name="fileDialog.name"
            :initial-folder="fileDialog.folder"
            :folders="folders"
            :taken-paths="takenPaths"
            :self-path="fileDialog.selfPath"
            @submit="applyFilePath"
            @cancel="closeFileDialog"
        />
    </div>
</template>
