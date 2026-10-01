<script setup lang="ts">
/**
 * Read-only skill inspector: the panel's third mode, so a skill can be explored
 * before it is forked. Duplicating in order to *look* is destructive — it writes
 * a row, consumes a name and needs deleting again.
 *
 * Read-only by construction: every input is a `<dd>` or a preview, and nothing
 * here can emit a write.
 *
 * Shipped skills need a separate component because the host's
 * `SkillController::detail()` returns `files` as `{path, bytes}` metadata with no
 * per-file read endpoint, so their sidecar *contents* are unavailable. Where
 * contents are missing the panel says so rather than rendering an empty editor
 * that looks like a bug.
 */
import { computed, ref, watch } from 'vue'
import { MdPreview } from 'md-editor-v3'
import DOMPurify from 'dompurify'
import { FileText, X, Pencil, Copy, TriangleAlert } from 'lucide-vue-next'
import { formatBytes, isMarkdownPath, sidecarFiles } from '../lib/skillFormat'
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
    /** True when the host exposes no per-file read, so contents cannot load. */
    contentsUnavailable?: boolean
    theme?: 'light' | 'dark'
}>()

const emit = defineEmits<{
    close: []
    edit: [name: string]
    duplicate: [name: string]
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

/** `undefined` when the content could not be read, which the template states. */
const activeContent = computed<string | undefined>(() => {
    if (!detail.value) return undefined
    if (activePath.value === SKILL_ENTRY_FILE) return detail.value.body
    return props.fileContents?.[activePath.value]
})

const facts = computed(() => {
    const d = detail.value
    if (!d) return []
    const out: Array<{ label: string; value: string }> = []
    const licence = 'license' in d ? d.license : null
    if (licence) out.push({ label: 'License', value: licence })
    if (d.compatibility) out.push({ label: 'Compatibility', value: d.compatibility })
    if (d.allowed_tools) out.push({ label: 'Allowed tools', value: d.allowed_tools })
    const meta = Object.entries(d.metadata ?? {})
    if (meta.length > 0) {
        out.push({ label: 'Metadata', value: meta.map(([k, v]) => `${k}: ${v}`).join('  ·  ') })
    }
    return out
})

const warnings = computed<SkillValidationEntry[]>(() => detail.value?.warnings ?? [])

/**
 * Without this, a sidecar open on one skill leaves an empty pane when the next
 * skill inspected happens to lack that file.
 */
watch(
    () => title.value,
    () => {
        activePath.value = SKILL_ENTRY_FILE
    },
)
</script>

<template>
    <section
        v-if="detail"
        class="rounded-xl border border-border bg-card p-5"
        data-test="viewer-pane"
    >
        <header class="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
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
            <button
                type="button"
                class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted"
                aria-label="Close inspector"
                data-test="viewer-close"
                @click="emit('close')"
            >
                <X class="h-4 w-4" />
            </button>
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

        <!-- The entry body is always first; sidecars follow in server order. -->
        <div class="mb-2 flex flex-wrap items-center gap-1 border-b border-border" data-test="viewer-tabs">
            <button
                type="button"
                class="-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs font-medium transition-colors"
                :class="activePath === SKILL_ENTRY_FILE
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'"
                data-test="viewer-tab-entry"
                @click="activePath = SKILL_ENTRY_FILE"
            >
                <FileText class="h-3.5 w-3.5" />
                SKILL.md
                <span class="text-[10px] text-muted-foreground">{{ formatBytes(detail.body_bytes) }}</span>
            </button>
            <button
                v-for="file in sidecars"
                :key="file.path"
                type="button"
                class="-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-1.5 font-mono text-xs font-medium transition-colors"
                :class="activePath === file.path
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'"
                :data-test="'viewer-tab-file'"
                @click="activePath = file.path"
            >
                {{ file.path }}
                <span class="text-[10px] text-muted-foreground">{{ formatBytes(file.bytes) }}</span>
            </button>
        </div>

        <div
            v-if="activeContent === undefined && contentsUnavailable"
            class="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
            data-test="viewer-contents-unavailable"
        >
            The host exposes no per-file read for shipped skills, so
            <span class="font-mono">{{ activePath }}</span> cannot be shown here.
            Its size is listed above. Duplicate the skill to get an editable copy.
        </div>
        <div
            v-else
            class="overflow-auto rounded-lg border border-border p-5"
            data-test="viewer-content"
        >
            <MdPreview
                v-if="isMarkdownPath(activePath)"
                :id="`viewer-preview-${title}`"
                class="md-preview"
                :model-value="activeContent ?? ''"
                :theme="theme ?? 'light'"
                :language="MARKDOWN_LOCALE"
                :sanitize="DOMPurify.sanitize"
            />
            <!-- A JSON or code sidecar rendered as markdown comes out as prose.
                 Same rule as the desk: markdown gets the renderer, anything else
                 is shown as it is. -->
            <pre
                v-else
                class="whitespace-pre-wrap break-words font-mono text-[13px] leading-[1.65]"
                data-test="viewer-plain"
            >{{ activeContent ?? '' }}</pre>
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
            <button
                type="button"
                class="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium transition-colors hover:bg-muted"
                data-test="viewer-dismiss"
                @click="emit('close')"
            >
                Close
            </button>
        </footer>
    </section>
</template>
