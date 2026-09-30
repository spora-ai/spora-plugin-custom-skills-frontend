<script setup lang="ts">
import { AlertTriangle, Copy, FileText, Package } from 'lucide-vue-next'
import type { PreShippedSkillSummary } from '../types'

/**
 * Card for one entry of the host's pre-shipped catalogue.
 *
 * Read-only by construction: the contract lists pre-shipped skills
 * under "Not endpoints (deliberately)", so there is no PUT and no
 * DELETE for them here. The single action is **Duplicate**, which
 * fetches the full detail and POSTs a copy onto the acting principal.
 *
 * That action is not a convenience. A skills panel where the shipped
 * catalogue is display-only gives a first-time author exactly one path
 * — start from a blank editor — and the shipped skills are the worked
 * examples people copy from. Forks also get a non-reserved name
 * (`forkName()`), because reusing a shipped slug answers
 * 409 `SKILL_NAME_RESERVED`.
 */
defineProps<{
    skill: PreShippedSkillSummary
    busy?: boolean
}>()

const emit = defineEmits<{ duplicate: [skill: PreShippedSkillSummary] }>()
</script>

<template>
    <article
        class="rounded-xl border border-border bg-card p-4"
        data-test="preshipped-card"
    >
        <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                    <h3 class="truncate text-sm font-semibold font-mono" data-test="preshipped-name">
                        {{ skill.name }}
                    </h3>
                    <span
                        class="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                    >
                        <Package class="h-3 w-3" />
                        {{ skill.source }}
                    </span>
                </div>
                <p class="mt-1 text-sm text-muted-foreground" data-test="preshipped-description">
                    {{ skill.description || 'No description.' }}
                </p>
            </div>

            <button
                type="button"
                :disabled="busy"
                class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
                data-test="duplicate-skill"
                @click="emit('duplicate', skill)"
            >
                <Copy class="h-3.5 w-3.5" />
                Duplicate
            </button>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span class="inline-flex items-center gap-1">
                <FileText class="h-3.5 w-3.5" />
                {{ skill.files_count }}
                {{ skill.files_count === 1 ? 'file' : 'files' }}
            </span>
            <span v-if="skill.license" class="font-mono">{{ skill.license }}</span>
            <span
                v-if="skill.has_warnings"
                class="inline-flex items-center gap-1 text-yellow-700 dark:text-yellow-300"
                data-test="preshipped-warnings"
            >
                <AlertTriangle class="h-3.5 w-3.5" />
                has warnings
            </span>
            <span class="italic">Read-only — shipped with the host.</span>
        </div>
    </article>
</template>
