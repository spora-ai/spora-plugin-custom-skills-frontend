<script setup lang="ts">
import { AlertTriangle, Inbox, Trash2 } from 'lucide-vue-next'

/**
 * Confirmation dialog for destructive, multi-agent writes.
 *
 * The only caller is skill deletion, and the reason this is a component rather
 * than a `confirm()` call is `affectedAgents`: a delete is a silent multi-agent
 * config change otherwise — the operator finds out days later from an agent that
 * suddenly can't find the skill, with no link back to the click.
 *
 * A `role="dialog"` div rather than a native `<dialog>`: `showModal()` is
 * unreliable in happy-dom and in the host's slot.
 */
defineProps<{
    open: boolean
    title: string
    body: string
    affectedAgents?: string[]
    confirmLabel?: string
    busy?: boolean
}>()

const emit = defineEmits<{
    confirm: []
    cancel: []
}>()
</script>

<template>
    <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        data-test="confirm-dialog"
    >
        <div class="absolute inset-0 bg-black/50" @click="emit('cancel')" />
        <div
            role="dialog"
            aria-modal="true"
            :aria-label="title"
            class="relative w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg"
        >
            <div class="mb-3 flex items-center gap-2">
                <AlertTriangle class="h-5 w-5 text-destructive" />
                <h2 class="text-base font-semibold">{{ title }}</h2>
            </div>

            <p class="text-sm text-muted-foreground" data-test="confirm-body">{{ body }}</p>

            <div
                v-if="affectedAgents && affectedAgents.length > 0"
                class="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3"
                data-test="confirm-blast-radius"
            >
                <p class="text-xs font-medium text-destructive">
                    This removes the skill from {{ affectedAgents.length }}
                    {{ affectedAgents.length === 1 ? 'agent' : 'agents' }}:
                </p>
                <ul class="mt-1.5 space-y-0.5">
                    <li
                        v-for="name in affectedAgents"
                        :key="name"
                        class="text-sm text-destructive"
                    >
                        {{ name }}
                    </li>
                </ul>
                <p class="mt-2 text-xs text-muted-foreground">
                    You can re-add it to each agent afterwards with “Enable on agent…”.
                </p>
            </div>

            <div v-else class="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
                <Inbox class="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>No agent currently has this skill on its allowlist.</span>
            </div>

            <div class="mt-5 flex justify-end gap-2">
                <button
                    type="button"
                    class="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
                    data-test="confirm-cancel"
                    @click="emit('cancel')"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    :disabled="busy"
                    class="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-destructive px-4 text-sm font-medium text-destructive-foreground shadow transition-colors hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
                    data-test="confirm-accept"
                    @click="emit('confirm')"
                >
                    <Trash2 class="h-3.5 w-3.5" />
                    {{ busy ? 'Deleting…' : (confirmLabel ?? 'Delete') }}
                </button>
            </div>
        </div>
    </div>
</template>
