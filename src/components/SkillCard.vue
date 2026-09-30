<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import {
    AlertTriangle,
    Bot,
    FileText,
    History,
    Pencil,
    Plus,
    Sparkles,
    Trash2,
} from 'lucide-vue-next'
import { formatBytes, lastEditedLabel, sidecarFiles } from '../lib/skillFormat'
import type { AgentSummary, CustomSkillResource, SkillAllowlistEntry } from '../types'

/**
 * Card for one of the caller's own custom skills.
 *
 * Carries the three affordances that separate "the skill works" from
 * "the user files a ticket":
 *
 *  1. **Allowlist readout + "Enable on agent…"** — an author who cannot
 *     see whether an agent may actually use their skill has no way to
 *     find out except by asking the agent and reading a rejection. The
 *     empty state names the failure mode verbatim, because that is the
 *     string the agent will produce.
 *  2. **Blast radius for delete** — the card asks the store for the
 *     skill's allowlist on expand and the page passes the names into
 *     `ConfirmDialog`. `scrubbed_agents` on the delete *response* is
 *     too late to warn anybody.
 *  3. **Restore previous version** — offered only when
 *     `has_previous` is true, i.e. when the server is actually holding
 *     a snapshot. Rendering a disabled button would imply a rollback
 *     that does not exist.
 *
 * The card is read-mostly: it emits intents (`edit`, `delete`,
 * `restore`, `enable`, `disable`) and the page/store owns the writes.
 */
const props = withDefaults(
    defineProps<{
        skill: CustomSkillResource
        allowlist: SkillAllowlistEntry[]
        agents: AgentSummary[]
        busy?: boolean
        allowlistLoaded?: boolean
    }>(),
    { busy: false, allowlistLoaded: false },
)

const emit = defineEmits<{
    edit: [name: string]
    delete: [name: string]
    restore: [name: string]
    loadAllowlist: [name: string]
    enable: [name: string, agentId: number]
    disable: [name: string, agentId: number]
}>()

const agentId = useId()
const selectedAgentId = ref<number | null>(null)
const showAgentPicker = ref(false)

const lastEdited = computed(() => lastEditedLabel(props.skill))
const sidecars = computed(() => sidecarFiles(props.skill))
const isAgentProvenance = computed(() => props.skill.provenance === 'agent')

/** Agents that do not already resolve this skill — the only useful offers. */
const enableCandidates = computed(() => {
    const already = new Set(props.allowlist.map((a) => a.id))
    return props.agents.filter((a) => !already.has(a.id))
})

function toggleAllowlist(): void {
    showAgentPicker.value = !showAgentPicker.value
    if (showAgentPicker.value && !props.allowlistLoaded) {
        emit('loadAllowlist', props.skill.name)
    }
}

function submitEnable(): void {
    if (selectedAgentId.value === null) return
    emit('enable', props.skill.name, selectedAgentId.value)
    selectedAgentId.value = null
    showAgentPicker.value = false
}

function scopeLabel(scope: SkillAllowlistEntry['scope']): string {
    return scope === 'principal' ? 'inherited default' : 'agent override'
}
</script>

<template>
    <article
        class="rounded-xl border border-border bg-card p-4"
        data-test="skill-card"
    >
        <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                    <h3 class="truncate text-sm font-semibold font-mono" data-test="skill-name">
                        {{ skill.name }}
                    </h3>
                    <span
                        v-if="isAgentProvenance"
                        class="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                        data-test="provenance-agent"
                    >
                        <Sparkles class="h-3 w-3" />
                        agent-written
                    </span>
                </div>
                <p class="mt-1 text-sm text-muted-foreground" data-test="skill-description">
                    {{ skill.description || 'No description — agents match skills on it, so add one.' }}
                </p>
                <p class="mt-1 text-xs text-muted-foreground" data-test="skill-last-edited">
                    {{ lastEdited }}
                </p>
            </div>

            <div class="flex shrink-0 items-center gap-1">
                <button
                    v-if="skill.has_previous"
                    type="button"
                    :disabled="busy"
                    class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
                    data-test="restore-skill"
                    @click="emit('restore', skill.name)"
                >
                    <History class="h-3.5 w-3.5" />
                    Restore previous version
                </button>
                <button
                    type="button"
                    :disabled="busy"
                    class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                    aria-label="Edit skill"
                    data-test="edit-skill"
                    @click="emit('edit', skill.name)"
                >
                    <Pencil class="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    :disabled="busy"
                    class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    aria-label="Delete skill"
                    data-test="delete-skill"
                    @click="emit('delete', skill.name)"
                >
                    <Trash2 class="h-3.5 w-3.5" />
                </button>
            </div>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span class="inline-flex items-center gap-1">
                <FileText class="h-3.5 w-3.5" />
                SKILL.md · {{ formatBytes(skill.files[0]?.bytes ?? skill.body_bytes) }}
            </span>
            <span v-for="file in sidecars" :key="file.path" class="font-mono">
                {{ file.path }} · {{ formatBytes(file.bytes) }}
            </span>
            <span
                v-if="skill.warning_count > 0"
                class="inline-flex items-center gap-1 text-yellow-700 dark:text-yellow-300"
                data-test="skill-warnings"
            >
                <AlertTriangle class="h-3.5 w-3.5" />
                {{ skill.warning_count }}
                {{ skill.warning_count === 1 ? 'warning' : 'warnings' }}
            </span>
        </div>

        <div class="mt-3 border-t border-border pt-3">
            <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Agents using this skill
                </span>
                <button
                    type="button"
                    class="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium transition-colors hover:bg-muted"
                    data-test="toggle-agent-picker"
                    @click="toggleAllowlist"
                >
                    <Plus class="h-3.5 w-3.5" />
                    Enable on agent…
                </button>
            </div>

            <p
                v-if="allowlist.length === 0"
                class="mt-2 text-xs text-muted-foreground"
                data-test="allowlist-empty"
            >
                Not enabled for any agent yet — add it to an agent's Skill tool
                settings before the agent can use it.
            </p>

            <ul v-else class="mt-2 flex flex-wrap gap-2" data-test="allowlist-list">
                <li
                    v-for="entry in allowlist"
                    :key="entry.id"
                    class="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs"
                >
                    <Bot class="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{{ entry.name }}</span>
                    <span class="text-muted-foreground">({{ scopeLabel(entry.scope) }})</span>
                    <button
                        type="button"
                        :disabled="busy"
                        class="text-muted-foreground underline underline-offset-2 transition-colors hover:text-destructive disabled:opacity-50"
                        :aria-label="`Disable on ${entry.name}`"
                        :data-test="`disable-on-${entry.id}`"
                        @click="emit('disable', skill.name, entry.id)"
                    >
                        remove
                    </button>
                </li>
            </ul>

            <div
                v-if="showAgentPicker"
                class="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-border p-2.5"
                data-test="agent-picker"
            >
                <div class="flex-1 min-w-[10rem]">
                    <label :for="agentId" class="mb-1 block text-xs font-medium">Agent</label>
                    <select
                        :id="agentId"
                        v-model="selectedAgentId"
                        data-test="agent-select"
                        class="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm"
                    >
                        <option :value="null" disabled>Choose an agent…</option>
                        <option v-for="a in enableCandidates" :key="a.id" :value="a.id">{{ a.name }}</option>
                    </select>
                </div>
                <button
                    type="button"
                    :disabled="busy || selectedAgentId === null"
                    class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    data-test="enable-confirm"
                    @click="submitEnable"
                >
                    <Plus class="h-3.5 w-3.5" />
                    Enable
                </button>
            </div>
        </div>
    </article>
</template>
