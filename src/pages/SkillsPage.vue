<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Package, Plus, Search, Sparkles } from 'lucide-vue-next'
import PrincipalChipRow from '../components/PrincipalChipRow.vue'
import PaneSearch from '../components/PaneSearch.vue'
import SkillCard from '../components/SkillCard.vue'
import PreShippedSkillCard from '../components/PreShippedSkillCard.vue'
import SkillEditor from '../components/SkillEditor.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import AlertBanner from '../components/AlertBanner.vue'
import { useSkillsStore } from '../stores/skills'
import { usePrincipalsStore } from '../stores/principals'
import * as api from '../api/customSkills'
import * as preshippedApi from '../api/preshippedSkills'
import { forkName } from '../lib/skillFormat'
import { HOST_CONTEXT_KEY, type PluginHostContext } from '../shims'
import type {
    CreateSkillDto,
    CustomSkillResource,
    PreShippedSkillSummary,
    UpdateSkillDto,
} from '../types'

/**
 * SkillsPage — the whole Custom Skills panel.
 *
 * Two panes, and the split is a *provenance* split, not a
 * feature split:
 *
 *   - **My skills** — the caller's principal's custom skills, full
 *     CRUD. Sourced from this plugin's REST contract.
 *   - **Pre-shipped** — the host catalogue from `GET /api/v1/skills`,
 *     read-only, grouped by `source` so "what came with the box" and
 *     "what came from another plugin" are visually separable. The
 *     contract lists these under "Not endpoints (deliberately)": the
 *     plugin must never re-serve them, or the two copies drift.
 *
 * **Responsive rule.** Under `lg` the two panes stack in source order
 * — "My skills" first, because every write happens there — and the
 * editor drops out of flow into a full-width panel below them. At
 * `lg` and up they sit side by side in a fixed 2-column grid. The
 * breakpoint is `lg` (not `md`) deliberately: each card carries a
 * description, a file manifest and an allowlist row, and at `md` the
 * pre-shipped pane's cards are compressed past the point where the
 * `Duplicate` button stops being reachable without horizontal
 * scrolling.
 *
 * **Delete is a two-step, read-then-write.** Clicking Delete fetches
 * `GET …/{name}/allowlist` and names the affected agents in the
 * confirmation, *before* `DELETE` runs. The `scrubbed_agents` on the
 * delete response arrive too late to warn anyone; they are used only
 * to report what actually changed.
 */
const route = useRoute()
const router = useRouter()
const store = useSkillsStore()
const principalsStore = usePrincipalsStore()
const hostContext = inject<PluginHostContext>(HOST_CONTEXT_KEY)

const mySearch = ref('')
const preSearch = ref('')
const notice = ref<string | null>(null)
const fileContents = ref<Record<string, string>>({})

const pendingDelete = ref<string | null>(null)
const deleteBlastRadius = ref<string[]>([])

const openSkillName = computed(() => {
    const param = route.params.name
    return typeof param === 'string' && param !== '' ? param : null
})
const isCreating = computed(() => route.query.create === '1')

const openSkill = computed<CustomSkillResource | null>(
    () => store.skillsByName[openSkillName.value ?? ''] ?? null,
)

function matches(haystack: readonly string[], needle: string): boolean {
    if (needle === '') return true
    const lowered = needle.toLowerCase()
    return haystack.some((h) => h.toLowerCase().includes(lowered))
}

const filteredMySkills = computed(() =>
    store.skills.filter((s) => matches([s.name, s.description], mySearch.value.trim())),
)

/**
 * Pre-shipped skills grouped by `source`, preserving the alphabetical
 * order the host returns within each group so re-grouping never
 * reorders a card an operator was reading.
 */
const groupedPreShipped = computed(() => {
    const groups = new Map<string, PreShippedSkillSummary[]>()
    for (const skill of store.preShipped) {
        if (!matches([skill.name, skill.description], preSearch.value.trim())) continue
        const bucket = groups.get(skill.source)
        if (bucket) bucket.push(skill)
        else groups.set(skill.source, [skill])
    }
    return [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([source, items]) => ({ source, items }))
})

const preShippedVisibleCount = computed(() =>
    groupedPreShipped.value.reduce((n, g) => n + g.items.length, 0),
)

function pushRoute(name: string | null, create = false): void {
    void router.push(create ? { name: 'skills', query: { create: '1' } } : name ? { name: 'skill', params: { name } } : { name: 'skills' })
}

function openEditor(name: string): void {
    fileContents.value = {}
    pushRoute(name)
}

function startCreate(): void {
    fileContents.value = {}
    pushRoute(null, true)
}

function closeEditor(): void {
    fileContents.value = {}
    pushRoute(null)
}

async function loadSidecarFiles(name: string): Promise<void> {
    const skill = store.skillsByName[name]
    if (!skill) return
    const contents: Record<string, string> = {}
    for (const file of skill.files) {
        if (file.path === 'SKILL.md') continue
        try {
            const content = await api.getSkillFile(name, file.path, principalsStore.selectedPrincipalId)
            contents[file.path] = content.content
        } catch {
            // A sidecar that can't be read (413 over the 50 000-byte cap,
            // or removed underneath us) is left blank; the manifest on
            // the card still tells the operator the file is there, and
            // the save-time error from the server is the real signal.
            contents[file.path] = ''
        }
    }
    fileContents.value = contents
}

async function handleSave(data: CreateSkillDto | UpdateSkillDto): Promise<void> {
    try {
        const saved = 'name' in data
            ? await store.createSkill(data)
            : await store.updateSkill(openSkillName.value ?? '', data)
        notice.value = saved.warning_count > 0
            ? `Saved with ${saved.warning_count} warning${saved.warning_count === 1 ? '' : 's'} — open the card to read them.`
            : null
        openEditor(saved.name)
    } catch {
        // The store has already surfaced `error` and `validationErrors`;
        // the editor renders the latter inline. Swallowing here keeps
        // the form open with the operator's input intact.
    }
}

async function handleDuplicate(skill: PreShippedSkillSummary): Promise<void> {
    store.clearError()
    try {
        const detail = await preshippedApi.getPreShippedSkill(skill.name)
        // The host's SkillController exposes only `index` and `show` —
        // there is no per-file read for a shipped skill, so a fork can
        // copy the frontmatter and the SKILL.md body but NOT the sidecar
        // contents. Copying empty placeholders would overwrite the file
        // set with blanks on the next save, so the operator is told
        // which files they need to re-add instead.
        const taken = new Set(store.skills.map((s) => s.name))
        const created = await store.duplicateSkill(
            skill,
            {
                body: detail.body,
                license: detail.license,
                compatibility: detail.compatibility,
                allowed_tools: detail.allowed_tools,
                metadata: detail.metadata,
                files: {},
            },
            forkName(skill.name, taken),
        )
        const missing = detail.files.filter((f) => f.path !== 'SKILL.md')
        notice.value = missing.length > 0
            ? `Created “${created.name}” from ${skill.name}. The host has no per-file read for shipped skills, so re-add ${missing.length} sidecar ${missing.length === 1 ? 'file' : 'files'} (${missing.map((f) => f.path).join(', ')}). It is not on any agent's allowlist yet.`
            : `Created “${created.name}” from ${skill.name}. It is not on any agent's allowlist yet.`
        openEditor(created.name)
    } catch {
        // `store.error` carries the message; the banner above renders it.
    }
}

async function handleRestore(name: string): Promise<void> {
    try {
        await store.restoreSkill(name)
        notice.value = `Restored the previous version of ${name}.`
    } catch {
        // 409 `NO_PREVIOUS_VERSION` lands in `store.error`.
    }
}

/**
 * Read the allowlist *before* opening the dialog. The write happens on
 * confirm; this read is what makes the confirmation honest.
 */
async function requestDelete(name: string): Promise<void> {
    store.clearError()
    deleteBlastRadius.value = []
    try {
        const agents = await api.getSkillAllowlist(name, principalsStore.selectedPrincipalId)
        deleteBlastRadius.value = agents.map((a) => a.name)
    } catch {
        // If the preview can't be read we still allow the delete, but
        // the dialog's fallback copy says the state is unknown rather
        // than claiming nothing is affected.
        deleteBlastRadius.value = []
    }
    pendingDelete.value = name
}

function cancelDelete(): void {
    pendingDelete.value = null
    deleteBlastRadius.value = []
}

async function confirmDelete(): Promise<void> {
    const name = pendingDelete.value
    if (name === null) return
    try {
        const result = await store.deleteSkill(name)
        const scrubbed = result.scrubbed_agents.map((a) => a.name)
        notice.value = scrubbed.length > 0
            ? `Deleted ${result.name} and removed it from ${scrubbed.length} agent${scrubbed.length === 1 ? '' : 's'}: ${scrubbed.join(', ')}.`
            : `Deleted ${result.name}.`
        if (openSkillName.value === name) closeEditor()
    } catch {
        // `store.error` carries the message.
    } finally {
        cancelDelete()
    }
}

async function handleEnable(name: string, agentId: number): Promise<void> {
    try {
        await store.enableOnAgent(name, agentId)
        notice.value = null
    } catch {
        // `store.error` carries the message.
    }
}

async function handleDisable(name: string, agentId: number): Promise<void> {
    try {
        await store.disableOnAgent(name, agentId)
    } catch {
        // `store.error` carries the message.
    }
}

onMounted(async () => {
    if (principalsStore.principals.length === 0) {
        await principalsStore.loadPrincipals()
    }
    await Promise.all([
        store.loadSkills(),
        store.loadPreShippedSkills(),
        store.loadAgents(),
    ])
})

watch(
    () => principalsStore.selectedPrincipalId,
    async (next, prev) => {
        if (next === prev) return
        notice.value = null
        await Promise.all([store.loadSkills(), store.loadAgents()])
    },
)
</script>

<template>
    <div class="min-h-screen bg-background">
        <main class="mx-auto max-w-7xl space-y-4 px-4 py-6 md:px-6">
            <header class="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
                <div>
                    <h1 class="text-lg font-semibold">Skills</h1>
                    <p class="text-xs text-muted-foreground">
                        Pre-shipped skills are read-only. Duplicate one to make it yours.
                    </p>
                </div>
                <button
                    type="button"
                    class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
                    data-test="new-skill"
                    @click="startCreate"
                >
                    <Plus class="h-3.5 w-3.5" />
                    New skill
                </button>
            </header>

            <PrincipalChipRow />

            <AlertBanner v-if="store.error" type="error" :message="store.error" />
            <AlertBanner v-if="notice" type="success" :message="notice" />

            <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <section class="space-y-3" data-test="pane-mine">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <h2 class="inline-flex items-center gap-1.5 text-sm font-semibold">
                            <Sparkles class="h-4 w-4 text-primary" />
                            My skills
                        </h2>
                        <div class="w-full sm:w-56">
                            <PaneSearch
                                v-model="mySearch"
                                label="My skills"
                                placeholder="Search my skills…"
                            />
                        </div>
                    </div>

                    <div
                        v-if="store.loading && store.skills.length === 0"
                        class="rounded-xl border border-border p-4 text-sm text-muted-foreground"
                    >
                        Loading your skills…
                    </div>

                    <div
                        v-else-if="store.skills.length === 0"
                        class="rounded-xl border border-dashed border-border p-6 text-center"
                        data-test="mine-empty"
                    >
                        <Sparkles class="mx-auto h-6 w-6 text-muted-foreground" />
                        <p class="mt-2 text-sm font-medium">No custom skills on this principal yet</p>
                        <p class="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                            Write one from scratch, or open the Pre-shipped pane and
                            <strong>Duplicate</strong> a shipped skill to start from a worked example.
                        </p>
                        <button
                            type="button"
                            class="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                            @click="startCreate"
                        >
                            <Plus class="h-3.5 w-3.5" />
                            New skill
                        </button>
                    </div>

                    <div
                        v-else-if="filteredMySkills.length === 0"
                        class="rounded-xl border border-dashed border-border p-6 text-center"
                        data-test="mine-search-empty"
                    >
                        <Search class="mx-auto h-6 w-6 text-muted-foreground" />
                        <p class="mt-2 text-sm text-muted-foreground">
                            No skill matches “{{ mySearch }}”. Clear the filter to see all
                            {{ store.skills.length }} on this principal.
                        </p>
                    </div>

                    <div v-else class="space-y-3" data-test="mine-list">
                        <SkillCard
                            v-for="skill in filteredMySkills"
                            :key="skill.name"
                            :skill="skill"
                            :allowlist="store.allowlistFor(skill.name)"
                            :allowlist-loaded="skill.name in store.allowlists"
                            :agents="store.agents"
                            :busy="store.saving"
                            @edit="openEditor"
                            @delete="requestDelete"
                            @restore="handleRestore"
                            @load-allowlist="store.loadAllowlist"
                            @enable="handleEnable"
                            @disable="handleDisable"
                        />
                    </div>
                </section>

                <section class="space-y-3" data-test="pane-preshipped">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <h2 class="inline-flex items-center gap-1.5 text-sm font-semibold">
                            <Package class="h-4 w-4 text-muted-foreground" />
                            Pre-shipped
                        </h2>
                        <div class="w-full sm:w-56">
                            <PaneSearch
                                v-model="preSearch"
                                label="Pre-shipped"
                                placeholder="Search pre-shipped…"
                            />
                        </div>
                    </div>

                    <div
                        v-if="store.preShippedLoading && store.preShipped.length === 0"
                        class="rounded-xl border border-border p-4 text-sm text-muted-foreground"
                    >
                        Loading the host catalogue…
                    </div>

                    <div
                        v-else-if="store.preShipped.length === 0"
                        class="rounded-xl border border-dashed border-border p-6 text-center"
                        data-test="preshipped-empty"
                    >
                        <Package class="mx-auto h-6 w-6 text-muted-foreground" />
                        <p class="mt-2 text-sm font-medium">This host ships no skills</p>
                        <p class="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                            The catalogue is served by the host at <code>/api/v1/skills</code>.
                            Install a plugin that registers skills, or write your own.
                        </p>
                    </div>

                    <div
                        v-else-if="preShippedVisibleCount === 0"
                        class="rounded-xl border border-dashed border-border p-6 text-center"
                        data-test="preshipped-search-empty"
                    >
                        <Search class="mx-auto h-6 w-6 text-muted-foreground" />
                        <p class="mt-2 text-sm text-muted-foreground">
                            No pre-shipped skill matches “{{ preSearch }}”. Clear the filter
                            to see all {{ store.preShipped.length }}.
                        </p>
                    </div>

                    <div v-else class="space-y-4" data-test="preshipped-list">
                        <div v-for="group in groupedPreShipped" :key="group.source">
                            <h3
                                class="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                                data-test="source-group"
                            >
                                {{ group.source }} · {{ group.items.length }}
                            </h3>
                            <div class="space-y-3">
                                <PreShippedSkillCard
                                    v-for="skill in group.items"
                                    :key="skill.name"
                                    :skill="skill"
                                    :busy="store.saving"
                                    @duplicate="handleDuplicate"
                                />
                            </div>
                        </div>
                    </div>
                </section>
            </div>

            <section
                v-if="openSkill || isCreating"
                class="rounded-xl border border-border bg-card p-5"
                data-test="editor-pane"
            >
                <SkillEditor
                    :skill="openSkill"
                    :saving="store.saving"
                    :validation-errors="store.validationErrors"
                    :file-contents="fileContents"
                    :theme="hostContext?.theme"
                    @save="handleSave"
                    @delete="requestDelete"
                    @restore="handleRestore"
                    @cancel="closeEditor"
                    @load-files="loadSidecarFiles"
                />
            </section>
        </main>

        <ConfirmDialog
            :open="pendingDelete !== null"
            :busy="store.saving"
            title="Delete this skill?"
            :body="pendingDelete
                ? `“${pendingDelete}” is removed from this principal, together with its sidecar files.`
                : ''"
            :affected-agents="deleteBlastRadius"
            @confirm="confirmDelete"
            @cancel="cancelDelete"
        />
    </div>
</template>
