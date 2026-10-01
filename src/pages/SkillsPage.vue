<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Package, Plus, Search, Sparkles } from 'lucide-vue-next'
import PrincipalChipRow from '../components/PrincipalChipRow.vue'
import PaneSearch from '../components/PaneSearch.vue'
import SkillCard from '../components/SkillCard.vue'
import PreShippedSkillCard from '../components/PreShippedSkillCard.vue'
import SkillEditor from '../components/SkillEditor.vue'
import SkillViewer from '../components/SkillViewer.vue'
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
    PreShippedSkillDetail,
    PreShippedSkillSummary,
    UpdateSkillDto,
} from '../types'

/**
 * The whole panel, split by *provenance*: "My skills" is the caller's principal
 * (full CRUD, this plugin's REST contract), "Pre-shipped" is the host catalogue at
 * `GET /api/v1/skills` (read-only, grouped by `source`; never re-served here, or
 * the copies drift).
 *
 * The breakpoint is `lg`, not `md`: at `md` the pre-shipped cards compress past the
 * point where `Duplicate` needs horizontal scrolling.
 *
 * **Delete is read-then-write.** The allowlist is fetched and its agents named in
 * the confirmation *before* `DELETE` runs; `scrubbed_agents` on the response
 * arrive too late to warn anyone.
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

/**
 * So a mode transition can scroll the newly opened pane into view. That scroll is
 * the fix for the reported "New skill does nothing": the pane rendered below both
 * lists, so on a ~20-skill catalogue the editor landed thousands of pixels below
 * the fold and the click produced no visible change.
 */
const editorPane = ref<HTMLElement | null>(null)
const viewerPane = ref<HTMLElement | null>(null)

const pendingDelete = ref<string | null>(null)
const deleteBlastRadius = ref<string[]>([])

const openSkillName = computed(() => {
    const param = route.params.name
    return typeof param === 'string' && param !== '' ? param : null
})
const isCreating = computed(() => route.query.create === '1')

/*
 * Viewer state: a third mode alongside create and edit, held in the query string
 * (`?view=<name>`) so it is linkable the same way the editor's location is.
 * Deliberately not a route param: `/:name` is the *edit* route, and a shipped
 * skill is not in `store.skillsByName` at all.
 */
const viewingName = computed(() => {
    const query = route.query.view
    return typeof query === 'string' && query !== '' ? query : null
})
const viewingShipped = ref<PreShippedSkillDetail | null>(null)
const viewingShippedLoading = ref(false)

const openSkill = computed<CustomSkillResource | null>(
    () => store.skillsByName[openSkillName.value ?? ''] ?? null,
)

/**
 * `prefers-reduced-motion` is honoured: the scroll is a convenience, and animating
 * it for someone who asked the OS not to is impossible to notice when it works.
 */
function revealPane(el: HTMLElement | null): void {
    if (!el) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
}

function matches(haystack: readonly string[], needle: string): boolean {
    if (needle === '') return true
    const lowered = needle.toLowerCase()
    return haystack.some((h) => h.toLowerCase().includes(lowered))
}

const filteredMySkills = computed(() =>
    store.skills.filter((s) => matches([s.name, s.description], mySearch.value.trim())),
)

/**
 * Preserving the order the host returns within each group, so re-grouping never
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

/**
 * Every push funnels through here so a mode transition clears the other modes'
 * query keys. Vue Router *merges* query on `push`, so a leftover `view=` behind
 * a `create=1` would stack both panes — a real failure mode, not a hypothetical.
 */
async function goTo(query: Record<string, string>, name?: string): Promise<void> {
    await router.push(
        name
            ? { name: 'skill', params: { name }, query }
            : { name: 'skills', query },
    )
    await nextTick()
    revealPane(editorPane.value ?? viewerPane.value)
}

function openEditor(name: string): void {
    fileContents.value = {}
    viewingShipped.value = null
    void goTo({}, name)
}

function startCreate(): void {
    fileContents.value = {}
    viewingShipped.value = null
    void goTo({ create: '1' })
}

function closeEditor(): void {
    fileContents.value = {}
    void goTo({})
}

/**
 * A custom skill is already in the store, so only the shipped path needs a fetch —
 * and that fetch is what makes "explore before you duplicate" work.
 */
async function openViewer(name: string): Promise<void> {
    viewingShipped.value = null
    if (store.skillsByName[name]) {
        fileContents.value = {}
        await goTo({ view: name })
        return
    }

    viewingShippedLoading.value = true
    try {
        viewingShipped.value = await preshippedApi.getPreShippedSkill(name)
        await goTo({ view: name })
    } catch {
        // `store.error` is scoped to the custom-skills pane, so this surfaces inline.
        notice.value = `Could not load the shipped skill “${name}”.`
    } finally {
        viewingShippedLoading.value = false
    }
}

function closeViewer(): void {
    viewingShipped.value = null
    void goTo({})
}

function duplicateViewedShipped(name: string): void {
    const summary = store.preShipped.find((s) => s.name === name)
    if (!summary) {
        void goTo({})
        return
    }
    void goTo({}).then(() => handleDuplicate(summary))
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
            // A sidecar that can't be read (413 over the 50 000-byte cap, or
            // removed underneath us) is left blank: the card's manifest still
            // lists it, and the save-time server error is the real signal.
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
        // The store already surfaced `error` and `validationErrors`; the editor
        // renders the latter inline. Swallowing keeps the form and its input.
    }
}

async function handleDuplicate(skill: PreShippedSkillSummary): Promise<void> {
    store.clearError()
    try {
        const detail = await preshippedApi.getPreShippedSkill(skill.name)
        // The host's SkillController exposes only `index` and `show` — no per-file
        // read for a shipped skill — so a fork copies the frontmatter and SKILL.md
        // body but NOT sidecar contents. Empty placeholders would overwrite the file
        // set with blanks on the next save, so the operator is told which to re-add.
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

/** The write happens on confirm, so this read is what makes the confirmation honest. */
async function requestDelete(name: string): Promise<void> {
    store.clearError()
    deleteBlastRadius.value = []
    try {
        const agents = await api.getSkillAllowlist(name, principalsStore.selectedPrincipalId)
        deleteBlastRadius.value = agents.map((a) => a.name)
    } catch {
        // The delete still proceeds, but the dialog says the state is unknown
        // rather than claiming nothing is affected.
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

            <!--
                The editor and the inspector sit ABOVE the two lists, not after
                them: the grid below renders the whole shipped catalogue
                unpaginated, so a form inserted beneath it lands thousands of
                pixels below the fold and reads as a dead button. The
                scroll-into-view in `goTo()` is belt-and-braces; the ordering is
                the fix.
            -->
            <section
                v-if="openSkill || isCreating"
                ref="editorPane"
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

            <section
                v-if="viewingName"
                ref="viewerPane"
                data-test="viewer-host"
            >
                <div
                    v-if="viewingShippedLoading"
                    class="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground"
                    data-test="viewer-loading"
                >
                    Loading {{ viewingName }}…
                </div>
                <SkillViewer
                    v-else
                    :skill="store.skillsByName[viewingName] ?? null"
                    :shipped="viewingShipped"
                    :file-contents="fileContents"
                    :contents-unavailable="viewingShipped !== null"
                    :theme="hostContext?.theme"
                    @close="closeViewer"
                    @edit="openEditor"
                    @duplicate="duplicateViewedShipped"
                />
            </section>

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
                            @view="openViewer"
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
                                    @view="(s) => openViewer(s.name)"
                                    @duplicate="handleDuplicate"
                                />
                            </div>
                        </div>
                    </div>
                </section>
            </div>
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
