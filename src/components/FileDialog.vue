<script setup lang="ts">
/**
 * Create or rename a file in a skill.
 *
 * One dialog for both because they are one operation: a rename that changes the
 * directory *is* a move, and "put this file in a folder" has no other verb here.
 * The old rail edited a path in place, which lost focus after the first character
 * (the rail keys on the path, so renaming re-created the input) and could not
 * express a folder at all without typing the whole thing blind.
 *
 * The folder picker is where the Agent Skills spec's `references/`, `scripts/` and
 * `assets/` come from — see {@link CONVENTIONAL_SKILL_FOLDERS}. The spec also
 * asks for references to stay one level deep from `SKILL.md`, so only the root
 * and top-level folders are offered; a file already deeper can still be renamed
 * in place, because the picker includes whatever folders exist.
 *
 * A `role="dialog"` div rather than a native `<dialog>`, for the reason given in
 * `ConfirmDialog`: `showModal()` is unreliable in happy-dom and in the host's slot.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { FileText, Folder } from 'lucide-vue-next'
import {
    CONVENTIONAL_SKILL_FOLDERS,
    fileFolderOptions,
    fileNameProblem,
    fileNameProblemText,
    joinFilePath,
    type FileFolderOption,
} from '../lib/skillFormat'

const props = defineProps<{
    open: boolean
    /** 'create' prefills a free name; 'rename' prefills the file's own. */
    mode: 'create' | 'rename'
    /** Prefill for the name field — a suggestion when creating, the basename when renaming. */
    initialName: string
    /** Prefill for the folder picker. */
    initialFolder: string
    /** Every folder that exists in this skill, for the picker. */
    folders: string[]
    /** Every stored path, for the duplicate check. */
    takenPaths: string[]
    /** The file being renamed, so it does not collide with itself. */
    selfPath?: string
}>()

const emit = defineEmits<{
    submit: [path: string]
    cancel: []
}>()

const name = ref('')
const folder = ref('')
const nameInput = ref<HTMLInputElement | null>(null)

const options = computed<FileFolderOption[]>(() => fileFolderOptions(props.folders))

/** The datalist drops the root: an empty option is not a suggestion anyone can pick. */
const suggestions = computed(() => options.value.filter((option) => option.value !== ''))

/**
 * Only shown once the operator has touched the field. Reporting "Name the file."
 * over a freshly-opened, pre-filled dialog is noise; reporting it the moment the
 * prefill is cleared is the point.
 */
const touched = ref(false)

const problem = computed(() =>
    fileNameProblem(name.value, folder.value, props.takenPaths, props.selfPath),
)
const error = computed(() => (touched.value && problem.value ? fileNameProblemText(problem.value) : null))

const title = computed(() => (props.mode === 'create' ? 'Add a file' : 'Rename file'))
const submitLabel = computed(() => (props.mode === 'create' ? 'Add file' : 'Save name'))

watch(
    () => props.open,
    async (open) => {
        if (!open) return
        name.value = props.initialName
        folder.value = props.initialFolder
        touched.value = false
        // Selected, not just focused: the common case is a single word over a
        // placeholder name, and that should not mean deleting it first.
        await nextTick()
        nameInput.value?.select()
    },
)

/** Enter submits from either field, so the folder does not have to be clicked away from. */
function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return
    event.preventDefault()
    submit()
}

function submit(): void {
    touched.value = true
    if (problem.value !== null) return
    emit('submit', joinFilePath(folder.value, name.value))
}
</script>

<template>
    <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        data-test="file-dialog"
    >
        <div class="absolute inset-0 bg-black/50" @click="emit('cancel')" />
        <div
            role="dialog"
            aria-modal="true"
            :aria-label="title"
            class="relative w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg"
        >
            <div class="mb-1 flex items-center gap-2">
                <FileText class="h-4 w-4 text-muted-foreground" />
                <h2 class="text-base font-semibold">{{ title }}</h2>
            </div>
            <p class="text-xs text-muted-foreground">
                A skill is a folder: <span class="font-mono">SKILL.md</span> plus whatever else it
                needs. Files in a subfolder are referenced relative to the skill root.
            </p>

            <div class="mt-4 space-y-3">
                <div>
                    <label :for="`${mode}-folder`" class="mb-1 block text-xs font-medium">
                        Folder
                    </label>
                    <div class="relative">
                        <Folder
                            class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                        />
                        <input
                            :id="`${mode}-folder`"
                            v-model="folder"
                            type="text"
                            list="file-dialog-folders"
                            spellcheck="false"
                            autocomplete="off"
                            placeholder="Skill root"
                            class="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
                            data-test="file-dialog-folder"
                            @keydown="onKeydown"
                        />
                        <datalist id="file-dialog-folders">
                            <option
                                v-for="option in suggestions"
                                :key="option.value"
                                :value="option.value"
                            />
                        </datalist>
                    </div>
                    <p class="mt-1 text-[11px] text-muted-foreground">
                        Leave empty for the skill root.
                        <span class="font-mono">{{ CONVENTIONAL_SKILL_FOLDERS.join('/</span>, <span class="font-mono">') }}</span>
                        are the spec's own names for the three usual cases; anything else is
                        allowed.
                    </p>
                </div>

                <div>
                    <label :for="`${mode}-name`" class="mb-1 block text-xs font-medium">
                        File name
                    </label>
                    <input
                        :id="`${mode}-name`"
                        ref="nameInput"
                        v-model="name"
                        type="text"
                        spellcheck="false"
                        autocomplete="off"
                        placeholder="REFERENCE.md"
                        :aria-invalid="error !== null"
                        :aria-describedby="error !== null ? `${mode}-name-error` : undefined"
                        class="h-9 w-full rounded-lg border border-border bg-background px-2.5 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
                        data-test="file-dialog-name"
                        @input="touched = true"
                        @keydown="onKeydown"
                    />
                    <p
                        v-if="error !== null"
                        :id="`${mode}-name-error`"
                        class="mt-1 text-[11px] text-destructive"
                        data-test="file-dialog-error"
                    >
                        {{ error }}
                    </p>
                    <p v-else class="mt-1 text-[11px] text-muted-foreground">
                        With an extension, so the right editor opens —
                        <span class="font-mono">.md</span> for prose, anything else as source.
                    </p>
                </div>
            </div>

            <div class="mt-5 flex justify-end gap-2">
                <button
                    type="button"
                    class="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
                    data-test="file-dialog-cancel"
                    @click="emit('cancel')"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    :disabled="error !== null && touched"
                    class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    data-test="file-dialog-submit"
                    @click="submit"
                >
                    {{ submitLabel }}
                </button>
            </div>
        </div>
    </div>
</template>
