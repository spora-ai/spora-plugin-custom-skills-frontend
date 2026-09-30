<script setup lang="ts">
import { ref, computed, watch, useId } from 'vue'
import { History, Plus, Save, Trash2, X } from 'lucide-vue-next'
import DOMPurify from 'dompurify'
import { MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import { errorsForField, unattachedErrors, lastEditedLabel } from '../lib/skillFormat'
import type { CreateSkillDto, CustomSkillResource, SkillValidationEntry, UpdateSkillDto } from '../types'

/**
 * Editor for one custom skill: frontmatter fields, the SKILL.md body,
 * and the sidecar file set.
 *
 * **Validation feedback is the point of this component.** The backend
 * runs `SkillValidator` and answers writes with 422 `SKILL_INVALID`
 * carrying a `ValidationResult` array. Each entry names a `path`
 * (the frontmatter key it applies to) and the operator needs to see it
 * *on that field* — a single "something is wrong" banner sends them
 * hunting. So errors render inline under their input, and everything
 * that isn't anchored to a field (validator findings on `metadata`,
 * plus every `warning`) renders in a single banner above the form.
 * Findings with no field and no severity distinction are never
 * dropped: an unanchored error is shown in the banner too.
 *
 * The body is edited with `md-editor-v3` (host-provided external) and
 * sanitised through DOMPurify for preview, matching the memories
 * editor. Theme comes from the mount-time `hostContext.theme`
 * snapshot — plugins don't get the live theme store; the host
 * unmounts and remounts the slot on theme change.
 *
 * `name` is a v-model-bound field on create and a read-only slug on
 * edit: the contract rejects a rename with 422 `VALIDATION_ERROR`, so
 * rendering it as an editable input would be a lie.
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
const SKILL_ENTRY_FILE = 'SKILL.md'
// Hoisted so the JSON braces/quotes don't force a quote-style escape
// in the template attribute (eslint `vue/html-quotes`).
const METADATA_PLACEHOLDER = '{"tier": "pro"}'

const props = withDefaults(
    defineProps<{
        skill?: CustomSkillResource | null
        saving?: boolean
        /** 422 `SKILL_INVALID` findings from the last write attempt. */
        validationErrors?: SkillValidationEntry[]
        /** Sidecar contents keyed by path, fetched by the page. */
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

const isEditing = computed(() => props.skill !== null)
const canSubmit = computed(() => !props.saving && name.value.trim().length > 0)

/**
 * Non-field findings: every `warning` the validator emitted, plus
 * errors whose `path` matches no rendered input. Both are actionable
 * and both would otherwise be invisible.
 */
const bannerEntries = computed<SkillValidationEntry[]>(() => [
    ...props.validationErrors.filter((e) => e.severity !== 'error'),
    ...unattachedErrors(props.validationErrors),
])

/** Warnings the *stored* skill already carries, shown on every open. */
const storedWarnings = computed<SkillValidationEntry[]>(() => props.skill?.warnings ?? [])

const lastEdited = computed(() => (props.skill ? lastEditedLabel(props.skill) : ''))
const showRestore = computed(() => props.skill?.has_previous === true)

function loadFrom(skill: CustomSkillResource | null): void {
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
        // Sidecar bytes are known from the manifest but their contents
        // are not; ask the page to fetch them so an edit-and-save
        // doesn't blank the file set (the contract fully replaces it).
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

/** Per-instance id scope so two editors on screen never share ids. */
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

function addSidecar(): void {
    sidecars.value = [...sidecars.value, { path: '', content: '' }]
}

function removeSidecar(index: number): void {
    sidecars.value = sidecars.value.filter((_, i) => i !== index)
}

function removeSidecarPath(index: number): void {
    removeSidecar(index)
}

/**
 * Frontmatter writes are free-form JSON, so a syntax error here would
 * otherwise 422 as an opaque "metadata must be an object". Parsing
 * client-side turns it into a message attached to the field.
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

    // `files` fully replaces the sidecar set, so blank rows are dropped
    // rather than sent as an empty path the server would reject.
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
    <div class="max-w-3xl" data-test="skill-editor">
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

            <div>
                <label :for="bodyId" class="mb-1.5 block text-sm font-medium">
                    SKILL.md <span class="text-xs text-muted-foreground">(Markdown)</span>
                </label>
                <MdEditor
                    :id="bodyId"
                    :model-value="body"
                    :rows="16"
                    placeholder="Instructions the agent follows when this skill is selected…"
                    :theme="theme ?? 'light'"
                    :language="SKILL_LOCALE"
                    :toolbars="SKILL_EDITOR_TOOLBARS"
                    :preview="false"
                    :sanitize="DOMPurify.sanitize"
                    mode="full"
                    data-test="field-body"
                    @update:model-value="body = $event"
                />
                <ul
                    v-for="entry in fieldErrors('body')"
                    :key="entry.code + entry.message"
                    class="mt-1 text-xs text-destructive"
                    data-test="field-error"
                >
                    {{ entry.message }}
                </ul>
            </div>

            <div>
                <div class="mb-1.5 flex items-center justify-between">
                    <span class="text-sm font-medium">Sidecar files</span>
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
                <p
                    v-if="sidecars.length === 0"
                    class="text-xs text-muted-foreground"
                    data-test="sidecars-empty"
                >
                    No sidecar files. References, templates and examples live in files
                    next to SKILL.md; the file set is replaced wholesale on save.
                </p>
                <div
                    v-for="(row, index) in sidecars"
                    :key="index"
                    class="mb-2 rounded-lg border border-border p-2.5"
                >
                    <div class="flex items-center gap-2">
                        <input
                            v-model="row.path"
                            type="text"
                            placeholder="examples/invoice.md"
                            class="h-9 flex-1 rounded-lg border border-input bg-background px-3 font-mono text-xs"
                            :aria-label="`Sidecar path ${index + 1}`"
                            data-test="sidecar-path"
                        />
                        <button
                            type="button"
                            class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            :aria-label="`Remove sidecar ${index + 1}`"
                            data-test="remove-sidecar"
                            @click="removeSidecarPath(index)"
                        >
                            <Trash2 class="h-3.5 w-3.5" />
                        </button>
                    </div>
                    <textarea
                        v-model="row.content"
                        rows="4"
                        placeholder="File contents…"
                        class="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs"
                        :aria-label="`Sidecar contents ${index + 1}`"
                        data-test="sidecar-content"
                    />
                </div>
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
