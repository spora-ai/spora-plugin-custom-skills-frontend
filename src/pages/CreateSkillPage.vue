<script setup lang="ts">
/**
 * `/new` — a create form, and a short one.
 *
 * Two design constraints are stated in the UI rather than left implicit:
 *
 * - **The name is asked first, and it is final.** The contract rejects a rename
 *   with 422, so the name is fixed at birth either way; asking now makes that a
 *   property of the flow rather than a trap discovered after writing the body.
 * - **A new skill always has a `SKILL.md`.** The reserved sidecar path is already
 *   synthesised server-side, so seeding it costs nothing on the wire and it turns
 *   the desk's file rail from "a list you populate" into "one row you cannot
 *   remove".
 *
 * Validity is checked as the operator types. The slug rules are narrow enough to
 * check locally, and a rejected create after filling in the body is the rude way
 * to find out.
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Check, ChevronRight, Layers, Lock, X } from 'lucide-vue-next'
import AlertBanner from '../components/AlertBanner.vue'
import { useSkillsStore } from '../stores/skills'
import { usePrincipalsStore } from '../stores/principals'
import * as preshippedApi from '../api/preshippedSkills'
import {
    errorsForField,
    forkName,
    isValidSkillName,
    skillNameConflict,
    starterBody,
    SKILL_LIMIT,
} from '../lib/skillFormat'
import type { PreShippedSkillDetail } from '../types'

const store = useSkillsStore()
const principals = usePrincipalsStore()
const route = useRoute()
const router = useRouter()

const name = ref('')
const description = ref('')

/**
 * A shipped skill to start from, named by `?template=`.
 *
 * This is what "Duplicate" in the catalogue means. It used to POST a copy and land
 * on the desk, which wrote a row the operator had not named yet and had not looked
 * at — and a name they could not change afterwards. Prefilling the form instead
 * keeps the copy deliberate: the name is theirs to choose, and nothing is written
 * until they press create.
 */
const templateName = computed(() => {
    const raw = route.query.template
    return typeof raw === 'string' ? raw : ''
})

const template = ref<PreShippedSkillDetail | null>(null)
const templateError = ref<string | null>(null)
const templateLoading = ref(false)

watch(
    templateName,
    async (wanted) => {
        template.value = null
        templateError.value = null
        if (wanted === '') return

        templateLoading.value = true
        try {
            const detail = await preshippedApi.getPreShippedSkill(wanted)
            template.value = detail
            // Only into an untouched form. Arriving at `/new?template=x` after
            // typing a name must not throw that name away.
            if (name.value.trim() === '') {
                name.value = forkName(
                    detail.name,
                    new Set([...store.skills.map((s) => s.name), ...store.preShipped.map((s) => s.name)]),
                )
            }
            if (description.value.trim() === '') description.value = detail.description
        } catch {
            templateError.value = `The host has no skill named “${wanted}”.`
        } finally {
            templateLoading.value = false
        }
    },
    { immediate: true },
)

/** The body the create will write: the template's, or the starter outline. */
const seedBody = computed(() => template.value?.body ?? starterBody(trimmedName.value))

/**
 * What the host cannot carry across.
 *
 * `SkillController::detail()` returns `files` as `{path, bytes}` metadata with no
 * per-file read, so a shipped skill's sidecar *contents* are unavailable. Saying so
 * here is the difference between an operator re-adding three files and wondering
 * why the copy came out with one.
 */
const sidecarsToReAdd = computed(() =>
    (template.value?.files ?? []).filter((file) => file.path !== 'SKILL.md'),
)

const principal = computed(() => principals.currentPrincipal)

const ownNames = computed(() => new Set(store.skills.map((s) => s.name)))
const shippedNames = computed(() => new Set(store.preShipped.map((s) => s.name)))

/** Trimmed first, because the trimmed value is what is sent — a name the operator
 *  padded with spaces is a valid name, and rejecting it would be a local rule the
 *  server does not have. */
const trimmedName = computed(() => name.value.trim())
const conflict = computed(() => skillNameConflict(trimmedName.value, ownNames.value, shippedNames.value))

const atCap = computed(() => store.skills.length >= SKILL_LIMIT)

/** Both fields are required server-side (`NAME_PATTERN`, `DESCRIPTION_REQUIRED`). */
const canSubmit = computed(
    () => !store.saving
        && !atCap.value
        && conflict.value === null
        && isValidSkillName(trimmedName.value)
        && description.value.trim() !== '',
)

function nameError(): string | null {
    if (trimmedName.value === '') return null
    if (conflict.value === 'own') return `${trimmedName.value} already exists on this principal.`
    if (conflict.value === 'shipped') return `${trimmedName.value} is a shipped skill, so the name is reserved.`
    if (!isValidSkillName(trimmedName.value)) {
        return 'Lowercase letters, digits and single hyphens, 1–64 characters, no leading or trailing hyphen.'
    }
    return null
}

async function submit(): Promise<void> {
    if (!canSubmit.value) return
    store.clearError()
    const from = template.value
    try {
        const created = await store.createSkill({
            name: trimmedName.value,
            description: description.value.trim(),
            body: seedBody.value,
            license: from?.license ?? null,
            compatibility: from?.compatibility ?? null,
            allowed_tools: from?.allowed_tools ?? null,
            metadata: from?.metadata ?? {},
            // Empty: the sidecar contents are not served, and an empty file the
            // operator did not write is worse than an absent one they are told about.
            files: {},
        })
        // The sidecar caveat has to survive the navigation, or the operator only
        // finds out when the rail is missing files the skill they copied had.
        if (sidecarsToReAdd.value.length > 0) {
            store.setNotice(
                `Created “${created.name}” from ${from?.name}. The host has no per-file read for `
                + `shipped skills, so re-add ${sidecarsToReAdd.value.length} `
                + `${sidecarsToReAdd.value.length === 1 ? 'sidecar file' : 'sidecar files'} `
                + `(${sidecarsToReAdd.value.map((f) => f.path).join(', ')}). `
                + 'It is not on any agent\'s allowlist yet.',
            )
        }
        await router.push({ path: `/skills/${created.name}` })
    } catch {
        // `error` and `validationErrors` are rendered by the layout and inline here,
        // so the form and its input survive the rejection.
    }
}
</script>

<template>
    <div class="mx-auto w-full max-w-xl px-6 py-10" data-test="create-page">
        <RouterLink
            :to="{ path: '/' }"
            class="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            data-test="create-back"
        >
            <ArrowLeft class="h-3.5 w-3.5" />
            Back to skills
        </RouterLink>

        <h2 class="mt-4 text-2xl font-semibold tracking-tight">New skill</h2>
        <p class="mt-1 text-sm text-muted-foreground">
            In <span class="font-medium text-foreground">{{ principal?.name ?? 'no principal' }}</span>.
            <template v-if="principal?.type === 'user'">Only you can see and edit these.</template>
            <template v-else>Everyone in the group can read these; writing needs to be an owner or an admin.</template>
        </p>

        <AlertBanner
            v-if="atCap"
            type="error"
            :message="`This principal already has ${SKILL_LIMIT} skills, which is the cap. Delete one, or switch principal.`"
        />

        <form class="mt-8 space-y-5" data-test="create-form" @submit.prevent="submit">
            <div>
                <label for="skill-name" class="block text-sm font-medium">
                    Name <span class="text-destructive">*</span>
                </label>
                <div
                    class="mt-1.5 flex items-stretch overflow-hidden rounded-lg border border-border bg-background focus-within:ring-2 focus-within:ring-ring/20"
                    :class="nameError() ? 'border-destructive' : ''"
                >
                    <span class="flex items-center border-r border-border bg-muted/40 pl-3 pr-2 font-mono text-xs text-muted-foreground">/</span>
                    <input
                        id="skill-name"
                        v-model="name"
                        type="text"
                        spellcheck="false"
                        autocomplete="off"
                        placeholder="invoice-drafting"
                        class="min-w-0 flex-1 bg-transparent px-2.5 py-2 font-mono text-sm outline-none"
                        :aria-invalid="nameError() !== null"
                        data-test="field-name"
                    />
                    <!-- Live validity, not a post-submit error. -->
                    <span v-if="trimmedName !== ''" class="flex items-center px-2.5">
                        <Check v-if="nameError() === null" class="h-4 w-4 text-emerald-600" data-test="name-valid" />
                        <X v-else class="h-4 w-4 text-destructive" data-test="name-invalid" />
                    </span>
                </div>
                <p v-if="nameError()" class="mt-1.5 text-[11px] text-destructive" data-test="name-error">
                    {{ nameError() }}
                </p>
                <p class="mt-1.5 text-[11px] text-muted-foreground">
                    Lowercase letters, digits and hyphens. Shown to the agent as its identifier, so name it
                    for what it does —
                    <span class="inline-flex items-center gap-1.5 font-medium text-foreground">
                        <Lock class="h-3 w-3" />
                        cannot be changed
                    </span>
                    once created.
                </p>
                <ul
                    v-for="entry in errorsForField(store.validationErrors, 'name')"
                    :key="entry.code + entry.message"
                    class="mt-1 text-[11px] text-destructive"
                    data-test="field-error"
                >
                    {{ entry.message }}
                </ul>
            </div>

            <div>
                <label for="skill-description" class="block text-sm font-medium">
                    Description <span class="text-destructive">*</span>
                </label>
                <!--
                    A textarea, matching the desk and the contract: `description` allows
                    1024 characters and the spec asks for both what the skill does and
                    when to use it, which is two or three sentences. As a single-line
                    input that overflowed invisibly to the right.
                -->
                <textarea
                    id="skill-description"
                    v-model="description"
                    rows="3"
                    maxlength="1024"
                    placeholder="How to draft an invoice for a customer, including VAT treatment."
                    class="mt-1.5 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring/20"
                    :aria-invalid="errorsForField(store.validationErrors, 'description').length > 0"
                    data-test="field-description"
                />
                <!-- Load-bearing, not decoration: it is the text a matching system
                     reads to decide whether this skill applies. An empty description
                     does not fail loudly at activation, it just never matches. -->
                <p class="mt-1.5 text-[11px] text-muted-foreground">
                    What this skill does and when to use it. This is what an agent reads to
                    decide whether it applies — an empty description does not fail loudly, it
                    simply never matches.
                    <span class="tabular-nums">{{ description.length }}/1024</span>
                </p>
                <ul
                    v-for="entry in errorsForField(store.validationErrors, 'description')"
                    :key="entry.code + entry.message"
                    class="mt-1 text-[11px] text-destructive"
                    data-test="field-error"
                >
                    {{ entry.message }}
                </ul>
            </div>

            <!-- Starting point. Blank is the default and always available, because
                 "SKILL.md exists" is the guarantee and "SKILL.md is empty" is not a
                 promise we need to make. -->
            <fieldset>
                <legend class="text-sm font-medium">Start from</legend>
                <div class="mt-2 space-y-2">
                    <label
                        class="flex items-start gap-2.5 rounded-lg border p-3"
                        :class="template === null
                            ? 'cursor-pointer border-border bg-background'
                            : 'border-border opacity-60'"
                    >
                        <input
                            type="radio"
                            :checked="template === null"
                            class="mt-0.5 h-4 w-4 accent-primary"
                            data-test="start-blank"
                            @change="router.push({ path: '/new' })"
                        />
                        <span class="min-w-0">
                            <span class="flex items-center gap-2 text-sm font-medium">
                                A blank
                                <span class="font-mono text-[11px] font-normal text-muted-foreground">SKILL.md</span>
                            </span>
                            <span class="mt-0.5 block text-[11px] text-muted-foreground">
                                A short starter outline. You can delete any part of it.
                            </span>
                        </span>
                    </label>

                    <!--
                        With `?template=` this is a radio rather than a link: the
                        choice is already made, and showing a link to a catalogue the
                        operator just left would suggest the selection is still open.
                    -->
                    <RouterLink
                        v-if="template === null"
                        :to="{ path: '/library' }"
                        class="flex items-start gap-2.5 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40"
                        data-test="start-shipped"
                    >
                        <span class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                            <Layers class="h-4 w-4 text-muted-foreground" />
                        </span>
                        <span class="min-w-0 flex-1">
                            <span class="flex items-center gap-2 text-sm font-medium">
                                A shipped skill
                                <ChevronRight class="h-3 w-3 text-muted-foreground" />
                            </span>
                            <span class="mt-0.5 block text-[11px] text-muted-foreground">
                                Pick one in the catalogue and copy it into this form.
                                {{ store.preShipped.length }} available.
                            </span>
                        </span>
                    </RouterLink>

                    <div
                        v-else
                        class="flex items-start gap-2.5 rounded-lg border border-primary bg-primary/5 p-3"
                        data-test="start-template"
                    >
                        <span class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                            <Check class="h-4 w-4 text-primary" />
                        </span>
                        <span class="min-w-0 flex-1">
                            <span class="flex flex-wrap items-center gap-2 text-sm font-medium">
                                <span class="truncate font-mono">{{ template.name }}</span>
                                <RouterLink
                                    :to="{ path: '/library' }"
                                    class="text-[11px] font-normal text-muted-foreground underline"
                                    data-test="template-change"
                                >
                                    choose another
                                </RouterLink>
                            </span>
                            <span class="mt-0.5 block text-[11px] text-muted-foreground">
                                Its description, licence and <span class="font-mono">SKILL.md</span>
                                come across. You can change all of them before creating.
                            </span>
                        </span>
                    </div>
                </div>

                <AlertBanner
                    v-if="templateError !== null"
                    type="error"
                    :message="templateError"
                />
                <p
                    v-if="templateLoading"
                    class="mt-1.5 text-[11px] text-muted-foreground"
                    data-test="template-loading"
                >
                    Loading {{ templateName }}…
                </p>
                <!-- Stated before the create, not only in the notice after it. -->
                <AlertBanner
                    v-if="sidecarsToReAdd.length > 0"
                    type="warning"
                    :message="`${template?.name ?? 'That skill'} also has ${sidecarsToReAdd.length} ${sidecarsToReAdd.length === 1 ? 'sidecar file' : 'sidecar files'} (${sidecarsToReAdd.map((f) => f.path).join(', ')}). The host serves no per-file read for shipped skills, so they will not come across — re-add them on the desk.`"
                />
            </fieldset>

            <div class="flex items-center gap-2 border-t border-border pt-5">
                <button
                    type="submit"
                    :disabled="!canSubmit"
                    class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    data-test="create-submit"
                >
                    {{ store.saving ? 'Creating…' : 'Create and start writing' }}
                    <ChevronRight class="h-4 w-4" />
                </button>
                <RouterLink
                    :to="{ path: '/' }"
                    class="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    data-test="create-cancel"
                >
                    Cancel
                </RouterLink>
            </div>
        </form>
    </div>
</template>
