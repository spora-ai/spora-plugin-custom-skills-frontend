<script setup lang="ts">
/**
 * One row of a principal's skill list.
 *
 * **Rows, not cards:** a skill's identity is its name plus its description, and
 * that pair fits on one line. Cards spend three lines of chrome per skill to hold
 * the same two fields, which is what made the old two-pane layout need its own
 * search box per pane.
 *
 * Everything at rest here comes out of `CustomSkillResource` — the warnings, the
 * provenance, the timestamps, the file count. The row deliberately does *not*
 * claim an "unused" pill or an agent count: both need a per-row
 * `GET …/{name}/allowlist`, and a pill that is wrong for every row whose
 * allowlist has not been read is worse than no pill. The menu is where that read
 * happens, on demand.
 */
import { computed, ref } from 'vue'
import { AlertTriangle, MoreHorizontal, Sparkles, Trash2, Users } from 'lucide-vue-next'
import { restoreExplanation, restoreLabel, updatedLabel } from '../lib/skillFormat'
import type { AgentSummary, CustomSkillResource, SkillAllowlistEntry } from '../types'

const props = withDefaults(
    defineProps<{
        skill: CustomSkillResource
        allowlist: SkillAllowlistEntry[]
        agents: AgentSummary[]
        allowlistLoaded?: boolean
        busy?: boolean
    }>(),
    { allowlistLoaded: false, busy: false },
)

const emit = defineEmits<{
    delete: [name: string]
    restore: [name: string]
    loadAllowlist: [name: string]
    enable: [name: string, agentId: number]
    disable: [name: string, agentId: number]
}>()

const menuOpen = ref(false)
const selectedAgentId = ref<number | null>(null)

const updated = computed(() => updatedLabel(props.skill.updated_at))
const isAgentProvenance = computed(() => props.skill.provenance === 'agent')
const candidates = computed(() => {
    const already = new Set(props.allowlist.map((a) => a.id))
    return props.agents.filter((a) => !already.has(a.id))
})

function scopeLabel(scope: SkillAllowlistEntry['scope']): string {
    return scope === 'principal' ? 'inherited default' : 'agent override'
}

function toggleMenu(): void {
    menuOpen.value = !menuOpen.value
    if (menuOpen.value && !props.allowlistLoaded) {
        emit('loadAllowlist', props.skill.name)
    }
}

function closeMenu(): void {
    menuOpen.value = false
}

function submitEnable(): void {
    if (selectedAgentId.value === null) return
    emit('enable', props.skill.name, selectedAgentId.value)
    selectedAgentId.value = null
    menuOpen.value = false
}

function submitDelete(): void {
    closeMenu()
    emit('delete', props.skill.name)
}
</script>

<template>
    <li
        class="group flex items-start gap-4 px-4 py-3 transition-colors hover:bg-muted/40"
        data-test="skill-row"
    >
        <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
                <RouterLink
                    :to="{ path: `/skills/${skill.name}` }"
                    class="truncate font-mono text-sm font-medium hover:underline"
                    data-test="skill-name"
                >
                    {{ skill.name }}
                </RouterLink>
                <!-- Warnings are load-bearing at rest, not just inside the desk: a
                     skill with an invalid frontmatter key is silently not matching,
                     and this is the only place that says so without opening it. -->
                <span
                    v-if="skill.warning_count > 0"
                    class="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-500/25"
                    data-test="row-warning-pill"
                >
                    <AlertTriangle class="h-3 w-3" />
                    {{ skill.warning_count }}
                    {{ skill.warning_count === 1 ? 'warning' : 'warnings' }}
                </span>
                <!-- Agent-authored: the panel is also how you find out an agent
                     rewrote one of your skills. -->
                <span
                    v-if="isAgentProvenance"
                    class="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-inset ring-border"
                    data-test="row-agent-pill"
                >
                    last edited by agent
                </span>
            </div>
            <p class="mt-0.5 truncate text-sm text-muted-foreground" data-test="skill-description">
                {{ skill.description || 'No description — agents match skills on it, so add one.' }}
            </p>
        </div>

        <div class="hidden shrink-0 items-center gap-5 text-xs text-muted-foreground sm:flex">
            <span data-test="skill-updated">updated {{ updated }}</span>
            <span data-test="skill-files">
                {{ skill.files.length }}
                {{ skill.files.length === 1 ? 'file' : 'files' }}
            </span>
        </div>

        <div class="relative shrink-0">
            <button
                v-if="menuOpen"
                type="button"
                class="fixed inset-0 z-10 cursor-default"
                aria-label="Close the menu"
                data-test="row-menu-backdrop"
                @click="closeMenu"
            />
            <button
                type="button"
                class="relative rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted focus:opacity-100 group-hover:opacity-100"
                :aria-label="`More actions for ${skill.name}`"
                data-test="row-actions"
                @click="toggleMenu"
            >
                <MoreHorizontal class="h-4 w-4" />
            </button>

            <div
                v-if="menuOpen"
                class="absolute right-0 top-8 z-20 w-64 overflow-hidden rounded-xl border border-border bg-card text-left shadow-lg"
                data-test="row-menu"
            >
                <p class="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Agents using this skill
                </p>

                <!-- Gated on the read having landed, not on the array being empty:
                     `toggleMenu` fires `loadAllowlist` on open, so an empty array
                     first paint is indistinguishable from "not read yet" — and this
                     component's own docblock rules out a claim that is wrong for
                     every row whose read has not arrived. -->
                <p
                    v-if="!allowlistLoaded"
                    class="px-3 py-2 text-[11px] leading-snug text-muted-foreground"
                    data-test="allowlist-loading"
                >
                    Reading the agents that use this skill…
                </p>
                <p
                    v-else-if="allowlist.length === 0"
                    class="px-3 py-2 text-[11px] leading-snug text-muted-foreground"
                    data-test="allowlist-empty"
                >
                    Not enabled for any agent yet — add it to an agent's Skill tool
                    settings before the agent can use it.
                </p>
                <ul v-else class="px-3 py-2" data-test="allowlist-list">
                    <li
                        v-for="entry in allowlist"
                        :key="entry.id"
                        class="flex items-center gap-1.5 py-0.5 text-xs"
                    >
                        <span class="min-w-0 flex-1 truncate">{{ entry.name }}</span>
                        <span class="text-[10px] text-muted-foreground">{{ scopeLabel(entry.scope) }}</span>
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

                <div class="border-t border-border p-2" data-test="agent-picker">
                    <label :for="`row-agent-${skill.name}`" class="mb-1 block px-1 text-[11px] text-muted-foreground">
                        Agent
                    </label>
                    <div class="flex items-center gap-1.5">
                        <select
                            :id="`row-agent-${skill.name}`"
                            v-model="selectedAgentId"
                            class="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-xs"
                            data-test="agent-select"
                        >
                            <option :value="null" disabled>Choose an agent…</option>
                            <option v-for="agent in candidates" :key="agent.id" :value="agent.id">
                                {{ agent.name }}
                            </option>
                        </select>
                        <button
                            type="button"
                            :disabled="busy || selectedAgentId === null"
                            class="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                            data-test="enable-confirm"
                            @click="submitEnable"
                        >
                            <Users class="h-3 w-3" />
                            Enable
                        </button>
                    </div>
                </div>

                <!-- Says which version it is putting back, and says the swap, for
                     the reason the desk already does: `restore()` snapshots the live
                     state before writing the previous one back, so this is a toggle
                     over two versions and not a step back through a history. A bare
                     "Restore previous version" reads as the latter, which makes a
                     restore look destructive when it is the safest thing in this
                     menu. -->
                <button
                    v-if="skill.has_previous"
                    type="button"
                    :disabled="busy"
                    :title="restoreExplanation(skill)"
                    :aria-label="restoreExplanation(skill)"
                    class="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
                    data-test="row-restore"
                    @click="closeMenu(); emit('restore', skill.name)"
                >
                    <Sparkles class="h-3.5 w-3.5" />
                    {{ restoreLabel(skill) }}
                </button>

                <button
                    type="button"
                    :disabled="busy"
                    class="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                    data-test="row-delete"
                    @click="submitDelete"
                >
                    <Trash2 class="h-3.5 w-3.5" />
                    Delete
                </button>
            </div>
        </div>
    </li>
</template>
