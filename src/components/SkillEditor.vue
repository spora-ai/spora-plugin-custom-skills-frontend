<script setup lang="ts">
import { ref, computed, watch, useId } from 'vue'
import { History, Plus, Save, Trash2, X } from 'lucide-vue-next'
import DOMPurify from 'dompurify'
import { MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import { errorsForField, unattachedErrors, lastEditedLabel } from '../lib/skillFormat'
import type { CreateSkillDto, CustomSkillResource, SkillValidationEntry, UpdateSkillDto } from '../types'

/**
 * Editor for one custom skill: frontmatter fields, the SKILL.md body and the
 * sidecar file set.
 *
 * **Validation feedback is the point.** Writes answer 422 `SKILL_INVALID` with a
 * `ValidationResult` array whose entries name the frontmatter `path` they apply
 * to, and the operator has to see each one *on that field* — a single banner
 * sends them hunting. Anything not anchored to a field (a `metadata` finding, every
 * `warning`) renders in one banner above the form; nothing is dropped.
 *
 * The body uses `md-editor-v3` (a host-provided external) and DOMPurify, matching
 * the memories editor. `theme` is the mount-time `hostContext.theme` snapshot:
 * plugins don't get the live theme store, the host remounts the slot instead.
 *
 * `name` is editable on create and a read-only slug on edit — the contract rejects
 * a rename with 422, so an editable input would be a lie.
 */
type SkillEditorToolbarItem =
    | 'bold' | 'underline' | 'italic' | 'strikeThrough'
    | 'title' | 'sub' | 'sup' | 'quote'
    | 'unorderedList' | 'orderedList' | 'task'
    | 'code' | 'codeRow' | 'link' | 'image' | 'table'
    | 'preview' | 'pageFullscreen' | 'catalog' | 'fullscreen'
    | '-'

const SKILL_EDITOR_TOOLBARS: SkillEditorToolbarItem[] = [
    'bold', 'underline', 'italic', 'strikeThrough',
    '-',
    'title', 'sub', 'sup', 'quote',
    '-',
    'unorderedList', 'orderedList', 'task',
    '-',
    'code', 'codeRow', 'link', 'image', 'table',
    '-',
    'preview',
    'pageFullscreen', 'fullscreen', 'catalog',
]

const SKILL_LOCALE = 'en-US'
// Hoisted so the JSON braces/quotes don't force a quote-style escape in the
// template attribute (eslint `vue/html-quotes`).
const SKILL_ENTRY_FILE = 'SKILL.md'
const METADATA_PLACEHOLDER = '{"tier": "pro"}'

const props = withDefaults(
    defineProps<{
        skill?: CustomSkillResource | null
        saving?: boolean
        /** 422 `SKILL_INVALID` findings from the last write attempt. */
        validationErrors?: SkillValidationEntry[]
        /** Sidecar contents keyed by path — the manifest knows the files exist. */
        fileContents?: Record<string, string>
        theme?: 'light' | 'dark'
    }>(),
    { skill: null, saving: false, validationErrors: () => [], fileContents: () => ({}), theme: undefined },
)

const emit = defineEmits<{
    save: [data: CreateSkillDto | UpdateSkillDto]
    delete: [name: string]
    restore: [name: string]
    cancel: []
    loadFiles: [name: string]
}>()

const name = ref('')
const description = ref('')
const license = ref('')
const compatibility = ref('')
const allowedTools = ref('')
const metadataJson = ref('')
const body = ref('')
const sidecars = ref<Array<{ path: string; content: string }>>([])

/**
 * Declared with the other editor state, not next to the tab helpers: `loadFrom()`
 * resets it from an `immediate` watcher, so a later declaration is a
 * temporal-dead-zone crash on the first render — invisible to a type-checker.
 */
const activeFile = ref<string>(SKILL_ENTRY_FILE)

const isEditing = computed(() => props.skill !== null)
const canSubmit = computed(() => !props.saving && name.value.trim().length > 0)

/** Every `warning`, plus errors whose `path` matches no input — both would be invisible. */
const bannerEntries = computed<SkillValidationEntry[]>(() => [
    ...props.validationErrors.filter((e) => e.severity !== 'error'),
    ...unattachedErrors(props.validationErrors),
])

/** Warnings the stored skill already carries — shown on every open, not just after a write. */
const storedWarnings = computed<SkillValidationEntry[]>(() => props.skill?.warnings ?? [])

const lastEdited = computed(() => (props.skill ? lastEditedLabel(props.skill) : ''))
const showRestore = computed(() => props.skill?.has_previous === true)

function loadFrom(skill: CustomSkillResource | null): void {
    // The previously open tab may be a sidecar this skill doesn't have, which
    // would show an empty editor.
    activeFile.value = SKILL_ENTRY_FILE
    name.value = skill?.name ?? ''
    description.value = skill?.description ?? ''
    license.value = skill?.license ?? ''
    compatibility.value = skill?.compatibility ?? ''
    allowedTools.value = skill?.allowed_tools ?? ''
    metadataJson.value =
        skill && Object.keys(skill.metadata).length > 0
            ? JSON.stringify(skill.metadata, null, 2)
            : ''
    body.value = skill?.body ?? ''
    sidecars.value = (skill?.files ?? [])
        .filter((f) => f.path !== SKILL_ENTRY_FILE)
        .map((f) => ({ path: f.path, content: '' }))
}

watch(
    () => props.skill,
    (skill) => {
        loadFrom(skill)
        // The manifest knows the sidecars but not their bytes, and save fully
        // replaces the file set — so fetch them or an edit blanks the files.
        if (skill && skill.files.some((f) => f.path !== SKILL_ENTRY_FILE)) {
            emit('loadFiles', skill.name)
        }
    },
    { immediate: true },
)

watch(
    () => props.fileContents,
    (contents) => {
        if (Object.keys(contents).length === 0) return
        sidecars.value = sidecars.value.map((row) => ({
            ...row,
            content: contents[row.path] ?? row.content,
        }))
    },
    { deep: true },
)

/** Per-instance id scope, so two editors on screen never share ids. */
const idScope = useId()
const nameId = `${idScope}-skill-name`
const descriptionId = `${idScope}-skill-description`
const licenseId = `${idScope}-skill-license`
const compatibilityId = `${idScope}-skill-compatibility`
const allowedToolsId = `${idScope}-skill-allowed-tools`
const metadataId = `${idScope}-skill-metadata`
const bodyId = `${idScope}-skill-body`

function fieldErrors(field: Parameters<typeof errorsForField>[1]) {
    return errorsForField(props.validationErrors, field)
}

/*
 * File tabs — the markdown editor is a per-file surface, not per-skill. Sidecars
 * are where references, templates and examples live, and a stacked `<textarea>`
 * made that the worst place in the panel to write prose. One tabbed editor gives
 * every file the same full-height surface and mounts only one, so a 20-file skill
 * does not ship 20 editors' worth of CodeMirror.
 */

const activeSidecarIndex = computed(() =>
    sidecars.value.findIndex((row) => row.path === activeFile.value),
)
const activeSidecar = computed(() =>
    activeSidecarIndex.value >= 0 ? sidecars.value[activeSidecarIndex.value] : null,
)

/**
 * The markdown under the cursor, whichever file is active. One computed setter
 * keeps the two backing stores (`body`, `sidecars[].content`) out of the
 * template's special cases.
 */
const activeContent = computed<string>({
    get() {
        if (activeFile.value === SKILL_ENTRY_FILE) return body.value
        return activeSidecar.value?.content ?? ''
    },
    set(next: string) {
        if (activeFile.value === SKILL_ENTRY_FILE) {
            body.value = next
            return
        }
        const index = activeSidecarIndex.value
        if (index < 0) return
        sidecars.value = sidecars.value.map((row, i) => (i === index ? { ...row, content: next } : row))
    },
})

/** Basename, so nested paths don't overflow the tab bar. */
function tabLabel(path: string): string {
    if (path === SKILL_ENTRY_FILE) return path
    const tail = path.split('/').pop()
    return tail && tail !== path ? tail : path
}

/**
 * The new row is given a unique default path and immediately becomes the active
 * tab: the operator clicked "Add file" to write in it, and leaving the cursor on
 * SKILL.md makes the click look like a no-op. A blank path is rejected by the
 * server, so it is never a useful starting state.
 */
function addSidecar(): void {
    const taken = new Set(sidecars.value.map((r) => r.path))
    let n = sidecars.value.length + 1
    let path = `notes-${n}.md`
    while (taken.has(path)) {
        n += 1
        path = `notes-${n}.md`
    }
    sidecars.value = [...sidecars.value, { path, content: '' }]
    activeFile.value = path
}

function removeSidecar(index: number): void {
    const removed = sidecars.value[index]?.path
    sidecars.value = sidecars.value.filter((_, i) => i !== index)
    if (removed !== undefined && activeFile.value === removed) {
        activeFile.value = SKILL_ENTRY_FILE
    }
}

/**
 * The tab is keyed on the path, so a rename that did not move `activeFile` would
 * blank the editor mid-typing — the path is the identity here.
 */
function renameActiveSidecar(path: string): void {
    const index = activeSidecarIndex.value
    if (index < 0) return
    const previous = sidecars.value[index].path
    if (previous === path) return
    sidecars.value = sidecars.value.map((row, i) => (i === index ? { ...row, path } : row))
    if (activeFile.value === previous) activeFile.value = path
}

/**
 * Frontmatter metadata is free-form JSON, so a syntax error would otherwise 422
 * as an opaque "metadata must be an object". Parsing client-side turns it into a
 * message attached to the field.
 */
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

const metadataError = ref<string | null>(null)

function handleSubmit(): void {
    metadataError.value = null
    const metadata = parseMetadata()
    if ('error' in metadata) {
        metadataError.value = metadata.error
        return
    }

    // `files` fully replaces the sidecar set, so blank rows are dropped rather
    // than sent as an empty path the server rejects.
    const files: Record<string, string> = {}
    for (const row of sidecars.value) {
        const path = row.path.trim()
        if (path === '' || path === SKILL_ENTRY_FILE) continue
        files[path] = row.content
    }

    const shared = {
        description: description.value.trim(),
        body: body.value,
        license: license.value.trim() === '' ? null : license.value.trim(),
        compatibility: compatibility.value.trim() === '' ? null : compatibility.value.trim(),
        allowed_tools: allowedTools.value.trim() === '' ? null : allowedTools.value.trim(),
        metadata: metadata.value,
        files,
    }

    emit('save', isEditing.value ? shared : { name: name.value.trim(), ...shared })
}
</script>

<template>
    <!-- Full width, not `max-w-3xl`: a 48rem column squeezes the live preview
         to a column of hyphenated words. -->
    <div class="w-full" data-test="skill-editor">
        <div class="mb-4 flex items-start justify-between gap-3">
            <div>
                <h2 class="text-lg font-semibold">
                    {{ isEditing ? 'Edit skill' : 'New skill' }}
                </h2>
                <p
                    v-if="lastEdited"
                    class="text-xs text-muted-foreground"
                    data-test="editor-last-edited"
                >
                    {{ lastEdited }}
                </p>
            </div>
            <div class="flex items-center gap-2">
                <button
                    v-if="showRestore"
                    type="button"
                    :disabled="saving"
                    class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
                    data-test="editor-restore"
                    @click="emit('restore', skill!.name)"
                >
                    <History class="h-3.5 w-3.5" />
                    Restore previous version
                </button>
                <button
                    type="button"
                    class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label="Close editor"
                    data-test="editor-close"
                    @click="emit('cancel')"
                >
                    <X class="h-4 w-4" />
                </button>
            </div>
        </div>

        <div
            v-if="bannerEntries.length > 0 || storedWarnings.length > 0"
            class="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm dark:border-yellow-800 dark:bg-yellow-950"
            role="status"
            data-test="validation-banner"
        >
            <p class="text-xs font-medium text-yellow-800 dark:text-yellow-200">
                {{ storedWarnings.length > 0 ? 'Saved with warnings' : 'Validation warnings' }}
            </p>
            <ul class="mt-1 space-y-0.5">
                <li
                    v-for="entry in [...bannerEntries, ...storedWarnings]"
                    :key="`${entry.code}-${entry.path ?? ''}-${entry.message}`"
                    class="text-xs text-yellow-800 dark:text-yellow-200"
                    data-test="banner-entry"
                >
                    <code class="font-mono">{{ entry.code }}</code>
                    <span v-if="entry.path"> ({{ entry.path }})</span>
                    — {{ entry.message }}
                </li>
            </ul>
        </div>

        <form class="space-y-4" @submit.prevent="handleSubmit">
            <div>
                <label :for="nameId" class="mb-1.5 block text-sm font-medium">
                    Name <span class="text-destructive">*</span>
                </label>
                <input
                    :id="nameId"
                    v-model="name"
                    type="text"
                    required
                    :readonly="isEditing"
                    placeholder="e.g. invoice-drafting"
                    class="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm font-mono shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring read-only:opacity-70"
                    :aria-invalid="fieldErrors('name').length > 0"
                    data-test="field-name"
                />
                <p
                    v-if="isEditing"
                    class="mt-1 text-xs text-muted-foreground"
                >
                    The slug is fixed after creation — a rename is rejected with 422.
                </p>
                <ul
                    v-for="entry in fieldErrors('name')"
                    :key="entry.code + entry.message"
                    class="mt-1 text-xs text-destructive"
                    data-test="field-error"
                >
                    {{ entry.message }}
                </ul>
            </div>

            <div>
                <label :for="descriptionId" class="mb-1.5 block text-sm font-medium">Description</label>
                <textarea
                    :id="descriptionId"
                    v-model="description"
                    rows="2"
                    maxlength="1024"
                    placeholder="One line an agent can match against when choosing a skill."
                    class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                    :aria-invalid="fieldErrors('description').length > 0"
                    data-test="field-description"
                />
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
                    <label :for="licenseId" class="mb-1.5 block text-sm font-medium">License</label>
                    <input
                        :id="licenseId"
                        v-model="license"
                        type="text"
                        placeholder="MIT"
                        class="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                        :aria-invalid="fieldErrors('license').length > 0"
                        data-test="field-license"
                    />
                    <ul
                        v-for="entry in fieldErrors('license')"
                        :key="entry.code + entry.message"
                        class="mt-1 text-xs text-destructive"
                        data-test="field-error"
                    >
                        {{ entry.message }}
                    </ul>
                </div>
                <div>
                    <label :for="compatibilityId" class="mb-1.5 block text-sm font-medium">Compatibility</label>
                    <input
                        :id="compatibilityId"
                        v-model="compatibility"
                        type="text"
                        placeholder="spora>=0.28"
                        class="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                        :aria-invalid="fieldErrors('compatibility').length > 0"
                        data-test="field-compatibility"
                    />
                    <ul
                        v-for="entry in fieldErrors('compatibility')"
                        :key="entry.code + entry.message"
                        class="mt-1 text-xs text-destructive"
                        data-test="field-error"
                    >
                        {{ entry.message }}
                    </ul>
                </div>
            </div>

            <div>
                <label :for="allowedToolsId" class="mb-1.5 block text-sm font-medium">
                    Allowed tools <span class="text-xs text-muted-foreground">(comma separated)</span>
                </label>
                <input
                    :id="allowedToolsId"
                    v-model="allowedTools"
                    type="text"
                    placeholder="read_email, send_email"
                    class="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm font-mono shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                    :aria-invalid="fieldErrors('allowed_tools').length > 0"
                    data-test="field-allowed-tools"
                />
                <ul
                    v-for="entry in fieldErrors('allowed_tools')"
                    :key="entry.code + entry.message"
                    class="mt-1 text-xs text-destructive"
                    data-test="field-error"
                >
                    {{ entry.message }}
                </ul>
            </div>

            <div>
                <label :for="metadataId" class="mb-1.5 block text-sm font-medium">
                    Metadata <span class="text-xs text-muted-foreground">(JSON object)</span>
                </label>
                <textarea
                    :id="metadataId"
                    v-model="metadataJson"
                    rows="2"
                    :placeholder="METADATA_PLACEHOLDER"
                    class="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                    :aria-invalid="metadataError !== null"
                    data-test="field-metadata"
                />
                <p
                    v-if="metadataError"
                    class="mt-1 text-xs text-destructive"
                    data-test="field-error"
                >
                    {{ metadataError }}
                </p>
            </div>

            <!-- The toolbar keeps `preview` so the operator can read the rendered
                 result without leaving the tab; it was previously disabled, which
                 made the editor write-only. -->
            <div>
                <div class="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span class="text-sm font-medium">
                        {{ activeFile === SKILL_ENTRY_FILE ? 'SKILL.md' : 'Sidecar file' }}
                        <span class="text-xs text-muted-foreground">(Markdown)</span>
                    </span>
                    <button
                        type="button"
                        class="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium transition-colors hover:bg-muted"
                        data-test="add-sidecar"
                        @click="addSidecar"
                    >
                        <Plus class="h-3.5 w-3.5" />
                        Add file
                    </button>
                </div>

                <div
                    v-if="sidecars.length > 0"
                    class="mb-2 flex flex-wrap items-center gap-1 border-b border-border"
                    data-test="editor-file-tabs"
                >
                    <button
                        type="button"
                        class="-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-1.5 font-mono text-xs font-medium transition-colors"
                        :class="activeFile === SKILL_ENTRY_FILE
                            ? 'border-primary text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground'"
                        data-test="editor-tab-entry"
                        @click="activeFile = SKILL_ENTRY_FILE"
                    >
                        SKILL.md
                    </button>
                    <button
                        v-for="row in sidecars"
                        :key="row.path"
                        type="button"
                        class="-mb-px inline-flex max-w-[16rem] items-center gap-1.5 truncate border-b-2 px-3 py-1.5 font-mono text-xs font-medium transition-colors"
                        :class="activeFile === row.path
                            ? 'border-primary text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground'"
                        data-test="editor-tab-file"
                        @click="activeFile = row.path"
                    >
                        {{ tabLabel(row.path) }}
                    </button>
                </div>

                <div
                    v-if="activeSidecar"
                    class="mb-2 flex items-center gap-2"
                    data-test="sidecar-controls"
                >
                    <input
                        :value="activeSidecar.path"
                        type="text"
                        placeholder="examples/invoice.md"
                        class="h-9 flex-1 rounded-lg border border-input bg-background px-3 font-mono text-xs"
                        :aria-label="`Path for ${activeSidecar.path}`"
                        data-test="sidecar-path"
                        @input="renameActiveSidecar(($event.target as HTMLInputElement).value)"
                    />
                    <button
                        type="button"
                        class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        :aria-label="`Remove ${activeSidecar.path}`"
                        data-test="remove-sidecar"
                        @click="removeSidecar(activeSidecarIndex)"
                    >
                        <Trash2 class="h-3.5 w-3.5" />
                    </button>
                </div>

                <MdEditor
                    :id="bodyId"
                    v-model="activeContent"
                    :rows="20"
                    :placeholder="activeFile === SKILL_ENTRY_FILE
                        ? 'Instructions the agent follows when this skill is selected…'
                        : `Contents of ${activeFile}…`"
                    :theme="theme ?? 'light'"
                    :language="SKILL_LOCALE"
                    :toolbars="SKILL_EDITOR_TOOLBARS"
                    :sanitize="DOMPurify.sanitize"
                    mode="full"
                    data-test="field-body"
                />
                <ul
                    v-for="entry in fieldErrors('body')"
                    :key="entry.code + entry.message"
                    class="mt-1 text-xs text-destructive"
                    data-test="field-error"
                >
                    {{ entry.message }}
                </ul>

                <p
                    v-if="sidecars.length === 0"
                    class="mt-1.5 text-xs text-muted-foreground"
                    data-test="sidecars-empty"
                >
                    No sidecar files. References, templates and examples live in
                    files next to SKILL.md; the file set is replaced wholesale on
                    save. “Add file” creates one and puts the cursor in it.
                </p>
            </div>

            <div class="flex flex-wrap items-center gap-3 border-t border-border pt-4">
                <button
                    type="submit"
                    :disabled="!canSubmit"
                    class="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    data-test="editor-save"
                >
                    <Save class="h-3.5 w-3.5" />
                    {{ saving ? 'Saving…' : (isEditing ? 'Save changes' : 'Create skill') }}
                </button>
                <button
                    v-if="isEditing"
                    type="button"
                    :disabled="saving"
                    class="inline-flex h-9 items-center justify-center rounded-lg border border-destructive/30 px-4 text-sm font-medium text-destructive shadow-sm transition-colors hover:bg-destructive/10 disabled:opacity-50"
                    data-test="editor-delete"
                    @click="emit('delete', skill!.name)"
                >
                    Delete
                </button>
                <button
                    type="button"
                    class="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
                    data-test="editor-cancel"
                    @click="emit('cancel')"
                >
                    Cancel
                </button>
            </div>
        </form>
    </div>
</template>
