<script setup lang="ts">
/**
 * Read-only skill inspector: the panel's third mode, so a skill can be explored
 * before it is forked. Duplicating in order to *look* is destructive — it writes
 * a row, consumes a name and needs deleting again.
 *
 * Read-only by construction: every input is a `<dd>` or a preview, and nothing
 * here can emit a write.
 *
 * No close affordance, in the header or the footer. This is a page body, not a
 * dialog: the page above it carries a back-link, and both of these buttons emitted
 * `close` for that same link's destination. Leaving a second way to leave a page is
 * the kind of redundancy that reads as an extra step, and an ✕ in the corner of a
 * page says "dismiss" when what it does is "go back".
 *
 * Shipped skills need a separate component: the host serves sidecar contents from a
 * per-file read that this asks for as each file is opened.
 */
import { computed, ref, watch } from 'vue'
import { MdPreview } from 'md-editor-v3'
import DOMPurify from 'dompurify'
import { ChevronRight, Copy, FileText, Folder, Pencil, TriangleAlert } from 'lucide-vue-next'
import SourceEditor from './SourceEditor.vue'
import {
    fileTree,
    flattenTree,
    formatBytes,
    formatJsonForPreview,
    previewModeFor,
    sidecarFiles,
} from '../lib/skillFormat'
import { MARKDOWN_LOCALE } from '../lib/markdownLocale'
import type { CustomSkillResource, PreShippedSkillDetail, SkillValidationEntry } from '../types'

// Local const, not a shared export: `sidecarFiles()` already filters on this
// literal, so there is one place that knows the value.
const SKILL_ENTRY_FILE = 'SKILL.md'

const props = defineProps<{
    /** Exactly one of these is set: the panel is inspecting a custom skill… */
    skill?: CustomSkillResource | null
    /** …or a shipped one. */
    shipped?: PreShippedSkillDetail | null
    fileContents?: Record<string, string>
    /** Paths the host declined to serve. Which failed is the caller's to know: it made the requests. */
    unavailablePaths?: string[]
    theme?: 'light' | 'dark'
}>()

const emit = defineEmits<{
    edit: [name: string]
    duplicate: [name: string]
    loadFile: [name: string, path: string]
}>()

const activePath = ref<string>(SKILL_ENTRY_FILE)

const title = computed(() => props.skill?.name ?? props.shipped?.name ?? '')
/**
 * The `!= null` is deliberate: these props have no declared default, so a caller
 * passing only one leaves the other `undefined`, not `null`. Testing `=== null`
 * made a shipped skill render as a custom one — no read-only badge, and an "Edit"
 * button for a skill this panel does not own.
 */
const isShipped = computed(() => !props.skill && props.shipped != null)
const detail = computed(() => props.skill ?? props.shipped ?? null)

const sidecars = computed(() => (detail.value ? sidecarFiles(detail.value as CustomSkillResource) : []))

/** `undefined` when not loaded: never asked, in flight, or refused. */
const activeContent = computed<string | undefined>(() => {
    if (!detail.value) return undefined
    if (activePath.value === SKILL_ENTRY_FILE) return detail.value.body
    return props.fileContents?.[activePath.value]
})

// Without this a refused file re-requests on every re-render, so a 404 becomes a loop.
const requested = ref<string[]>([])

const isUnavailable = computed(() => (props.unavailablePaths ?? []).includes(activePath.value))

/** Distinct from `isUnavailable`, which is an answer rather than a wait. */
const isPending = computed(
    () => activePath.value !== SKILL_ENTRY_FILE && requested.value.includes(activePath.value),
)

watch(
    activePath,
    (path) => {
        if (path === SKILL_ENTRY_FILE) return
        if ((props.fileContents ?? {})[path] !== undefined) return
        if (requested.value.includes(path)) return
        requested.value = [...requested.value, path]
        emit('loadFile', title.value, path)
    },
    { immediate: true },
)

const facts = computed(() => {
    const d = detail.value
    if (!d) return []
    const out: Array<{ label: string; value: string }> = []
    const licence = 'license' in d ? d.license : null
    if (licence) out.push({ label: 'License', value: licence })
    if (d.compatibility) out.push({ label: 'Compatibility', value: d.compatibility })
    const meta = Object.entries(d.metadata ?? {})
    if (meta.length > 0) {
        out.push({ label: 'Metadata', value: meta.map(([k, v]) => `${k}: ${v}`).join('  ·  ') })
    }
    return out
})

const warnings = computed<SkillValidationEntry[]>(() => detail.value?.warnings ?? [])

/**
 * The rail, on the desk's model: `SKILL.md` is a fixed first row and folders are
 * derived from the paths rather than stored, because the contract's `files` is a
 * flat `path => content` map and a directory exists exactly as long as a file
 * inside it does. Reusing `fileTree`/`flattenTree` rather than re-deriving is what
 * keeps the two surfaces' ordering and indentation identical.
 */
const tree = computed(() => fileTree(sidecars.value.map((file) => file.path)))
const collapsed = ref<string[]>([])
const rows = computed(() => flattenTree(tree.value, collapsed.value))

const isCollapsed = (path: string): boolean => collapsed.value.includes(path)

function toggleFolder(path: string): void {
    collapsed.value = isCollapsed(path)
        ? collapsed.value.filter((p) => p !== path)
        : [...collapsed.value, path]
}

/** The size a rail row shows: the entry's body, a sidecar's stored length. */
function fileSize(path: string): number {
    if (path === SKILL_ENTRY_FILE) return detail.value?.body_bytes ?? 0
    return sidecars.value.find((file) => file.path === path)?.bytes ?? 0
}

/**
 * How the open file is rendered, and the text to render it from.
 *
 * The mode comes from the contents as well as the extension, because a `.txt` that
 * is really a binary is the case an extension-only rule gets wrong — and this panel
 * is where an operator goes to find out what a skill actually contains.
 */
const previewMode = computed(() =>
    activeContent.value === undefined ? null : previewModeFor(activePath.value, activeContent.value),
)

/** Pretty-printed JSON, or the file as written when it does not parse. */
const formattedContents = computed(() => {
    if (previewMode.value !== 'formatted' || activeContent.value === undefined) return null
    return formatJsonForPreview(activeContent.value)
})

const jsonDidNotParse = computed(
    () => previewMode.value === 'formatted' && formattedContents.value === null,
)

/**
 * Without this, a sidecar open on one skill leaves an empty pane when the next
 * skill inspected happens to lack that file.
 */
watch(
    () => title.value,
    () => {
        activePath.value = SKILL_ENTRY_FILE
        // A folder that was open may not exist on the next skill, and a rail that
        // silently keeps a stale expansion looks like data loss.
        collapsed.value = []
        requested.value = []
    },
)
</script>

<template>
    <section
        v-if="detail"
        class="rounded-xl border border-border bg-card p-5"
        data-test="viewer-pane"
    >
        <header class="mb-4 border-b border-border pb-3">
            <div class="min-w-0">
                <div class="flex items-center gap-2">
                    <h2 class="truncate font-mono text-sm font-semibold" data-test="viewer-title">
                        {{ title }}
                    </h2>
                    <span
                        v-if="isShipped"
                        class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                        data-test="viewer-readonly-badge"
                    >
                        Pre-shipped · read-only
                    </span>
                </div>
                <p class="mt-1 text-sm text-muted-foreground" data-test="viewer-description">
                    {{ detail.description }}
                </p>
            </div>
        </header>

        <dl
            v-if="facts.length > 0"
            class="mb-4 grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2"
            data-test="viewer-facts"
        >
            <div v-for="fact in facts" :key="fact.label" class="flex gap-2">
                <dt class="shrink-0 font-medium text-muted-foreground">{{ fact.label }}</dt>
                <dd class="min-w-0 break-words font-mono">{{ fact.value }}</dd>
            </div>
        </dl>

        <div
            v-if="warnings.length > 0"
            class="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
            data-test="viewer-warnings"
        >
            <TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <ul class="space-y-1">
                <li v-for="w in warnings" :key="w.code + w.message">
                    <span class="font-mono font-medium">{{ w.code }}</span> — {{ w.message }}
                </li>
            </ul>
        </div>

        <!--
            The desk's rail, read-only: a skill is a folder of files, and a flat tab
            strip both lost the structure and ran out of room for a skill with a
            handful of sidecars. No add, rename or remove affordances — nothing here
            can write.
        -->
        <div class="flex min-h-0 flex-col gap-4 md:flex-row">
            <aside
                class="flex max-h-64 w-56 shrink-0 flex-col rounded-lg border border-border bg-muted/30 md:max-h-96"
                data-test="viewer-rail"
            >
                <h3
                    class="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                    Files
                </h3>
                <nav class="scroll-quiet overflow-auto p-1.5 text-sm" data-test="viewer-rail-nav">
                    <button
                        type="button"
                        class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[13px] transition-colors hover:bg-background"
                        :class="activePath === SKILL_ENTRY_FILE ? 'bg-background shadow-sm ring-1 ring-border' : ''"
                        data-test="viewer-tab-entry"
                        @click="activePath = SKILL_ENTRY_FILE"
                    >
                        <FileText class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span class="truncate">{{ SKILL_ENTRY_FILE }}</span>
                        <span class="ml-auto shrink-0 text-[10px] text-muted-foreground">
                            {{ formatBytes(detail.body_bytes) }}
                        </span>
                    </button>

                    <template v-for="row in rows" :key="row.path">
                        <button
                            v-if="row.kind === 'folder'"
                            type="button"
                            class="flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left font-mono text-[13px] text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                            :style="{ paddingLeft: `${0.5 + row.depth * 0.75}rem` }"
                            :aria-expanded="!isCollapsed(row.path)"
                            :data-test="`viewer-rail-folder-${row.path}`"
                            @click="toggleFolder(row.path)"
                        >
                            <ChevronRight
                                class="h-3 w-3 shrink-0 transition-transform"
                                :class="isCollapsed(row.path) ? '' : 'rotate-90'"
                            />
                            <Folder class="h-3.5 w-3.5 shrink-0" />
                            <span class="truncate">{{ row.name }}</span>
                        </button>

                        <button
                            v-else
                            type="button"
                            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[13px] transition-colors hover:bg-background"
                            :class="activePath === row.path ? 'bg-background shadow-sm ring-1 ring-border' : ''"
                            :style="row.depth > 0 ? { paddingLeft: `${1.25 + (row.depth - 1) * 0.75}rem` } : undefined"
                            :data-test="`viewer-rail-file-${row.path}`"
                            @click="activePath = row.path"
                        >
                            <FileText class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span class="min-w-0 flex-1 truncate">{{ row.name }}</span>
                            <span class="shrink-0 text-[10px] text-muted-foreground">
                                {{ formatBytes(fileSize(row.path)) }}
                            </span>
                        </button>
                    </template>
                </nav>
            </aside>

            <div class="min-w-0 flex-1">
                <!-- A blank editor during a pending read reads as a broken file. -->
                <p
                    v-if="activeContent === undefined && isUnavailable"
                    class="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
                    data-test="viewer-contents-unavailable"
                >
                    <span class="font-mono">{{ activePath }}</span> could not be read.
                    Its size is listed in the rail. A file the host will not serve is
                    either missing or over the 50 KB per-file limit. Duplicate the
                    skill to get an editable copy.
                </p>
                <p
                    v-else-if="activeContent === undefined && isPending"
                    class="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
                    data-test="viewer-contents-loading"
                >
                    Reading <span class="font-mono">{{ activePath }}</span>…
                </p>
                <div
                    v-else
                    class="scroll-quiet overflow-auto rounded-lg border border-border p-5"
                    data-test="viewer-content"
                >
                    <div
                        v-if="previewMode === 'binary'"
                        class="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
                        data-test="viewer-binary"
                    >
                        <span class="font-mono">{{ activePath }}</span>
                        is not a text format, so it cannot be shown here. Its size is
                        listed in the rail.
                    </div>

                    <template v-else>
                        <p
                            v-if="jsonDidNotParse"
                            class="mb-3 text-xs text-amber-700"
                            data-test="viewer-json-invalid"
                        >
                            This file is not valid JSON, so it is shown as written.
                        </p>
                        <MdPreview
                            v-if="previewMode === 'markdown'"
                            :id="`viewer-preview-${title}`"
                            class="md-preview"
                            :model-value="activeContent ?? ''"
                            :theme="theme ?? 'light'"
                            :language="MARKDOWN_LOCALE"
                            :sanitize="DOMPurify.sanitize"
                        />
                        <!--
                            JSON gets reindented; anything else is shown as source,
                            highlighted when there is a mode for it. Both are
                            read-only, and the editor is the same one the desk uses, so
                            a file looks the same in both places.
                        -->
                        <pre
                            v-else-if="previewMode === 'formatted' && formattedContents !== null"
                            class="scroll-quiet overflow-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed"
                            data-test="viewer-formatted"
                        >{{ formattedContents }}</pre>
                        <SourceEditor
                            v-else
                            :model-value="activeContent ?? ''"
                            :path="activePath"
                            read-only
                        />
                    </template>
                </div>
            </div>
        </div>

        <footer class="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <button
                v-if="!isShipped"
                type="button"
                class="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
                data-test="viewer-edit"
                @click="emit('edit', title)"
            >
                <Pencil class="h-3.5 w-3.5" />
                Edit skill
            </button>
            <button
                v-else
                type="button"
                class="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
                data-test="viewer-duplicate"
                @click="emit('duplicate', title)"
            >
                <Copy class="h-3.5 w-3.5" />
                Duplicate to make it mine
            </button>
        </footer>
    </section>
</template>
