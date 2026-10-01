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
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, Check, ChevronRight, Layers, Lock, X } from 'lucide-vue-next'
import AlertBanner from '../components/AlertBanner.vue'
import { useSkillsStore } from '../stores/skills'
import { usePrincipalsStore } from '../stores/principals'
import {
    errorsForField,
    isValidSkillName,
    skillNameConflict,
    starterBody,
    SKILL_LIMIT,
} from '../lib/skillFormat'

const store = useSkillsStore()
const principals = usePrincipalsStore()
const router = useRouter()

const name = ref('')
const description = ref('')

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
    try {
        const created = await store.createSkill({
            name: trimmedName.value,
            description: description.value.trim(),
            body: starterBody(trimmedName.value),
            license: null,
            compatibility: null,
            allowed_tools: null,
            metadata: {},
            files: {},
        })
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
                <input
                    id="skill-description"
                    v-model="description"
                    type="text"
                    maxlength="1024"
                    placeholder="How to draft an invoice for a customer, including VAT treatment."
                    class="mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/20"
                    :aria-invalid="errorsForField(store.validationErrors, 'description').length > 0"
                    data-test="field-description"
                />
                <!-- Load-bearing, not decoration: it is the text a matching system
                     reads to decide whether this skill applies. An empty description
                     does not fail loudly at activation, it just never matches. -->
                <p class="mt-1.5 text-[11px] text-muted-foreground">
                    One sentence on when this skill applies. This is what an agent reads to decide
                    whether to use it — an empty description does not fail loudly, it simply never
                    matches.
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
                 promise we need to make. The alternative is a route into the
                 catalogue rather than a third option here: reading a shipped skill
                 before copying it is a different activity from naming your own. -->
            <fieldset>
                <legend class="text-sm font-medium">Start from</legend>
                <div class="mt-2 space-y-2">
                    <label class="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-background p-3">
                        <input type="radio" checked class="mt-0.5 h-4 w-4 accent-primary" data-test="start-blank" />
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

                    <RouterLink
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
                                Read one first in the catalogue, then copy it.
                                {{ store.preShipped.length }} available.
                            </span>
                        </span>
                    </RouterLink>
                </div>
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
