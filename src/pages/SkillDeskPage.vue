<script setup lang="ts">
/**
 * `/p/{principalId}/skill/:name` — the writing surface for one principal-scoped skill.
 *
 * **The principal is part of this route, and the read waits for it** — see `lib/hostRoute.ts`. A URL
 * naming only a skill cannot say whose it is, and an absent `?principal_id=` resolves to the caller's
 * own rather than refusing: the silent default behind a group-owned skill reporting "No skill named".
 */
import { computed, inject, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'
import SkillDesk from '../components/SkillDesk.vue'
import * as api from '../api/customSkills'
import * as preshippedApi from '../api/preshippedSkills'
import * as toolsApi from '../api/tools'
import { useSkillsStore } from '../stores/skills'
import { usePrincipalsStore } from '../stores/principals'
import { HOST_CONTEXT_KEY, type PluginHostContext } from '../shims'
import type {
    CustomSkillResource,
    PreShippedSkillDetail,
    PreShippedSkillSummary,
    ToolSummary,
    UpdateSkillDto,
} from '../types'
import { declaredToolsSummary, plural } from '../lib/skillFormat'
import { principalIdInLocalPath } from '../lib/hostRoute'
import { homePath, newSkillPath } from '../lib/paths'

const route = useRoute()
const router = useRouter()
const store = useSkillsStore()
const principals = usePrincipalsStore()
const hostContext = inject<PluginHostContext>(HOST_CONTEXT_KEY)

const name = computed(() => {
    const param = route.params.name
    return typeof param === 'string' ? param : ''
})

/** The principal this skill belongs to, read from the route rather than the store: they agree only
 *  once `App.vue` has reconciled them, and a page correct after someone else's await is that race. */
const routePrincipalId = computed(() => principalIdInLocalPath(route.path))

const principalId = computed<number | null>(() =>
    routePrincipalId.value ?? principals.selectedPrincipalId,
)

const loaded = ref<CustomSkillResource | null>(null)
const missing = ref(false)
const fileContents = ref<Record<string, string>>({})
/** Non-null when this name belongs to the host catalogue rather than a principal. */
const shipped = ref<PreShippedSkillSummary | null>(null)

/** A shipped skill has no row on any principal; read-only mode never reads these fields. */
function deskShape(detail: PreShippedSkillDetail): CustomSkillResource {
    return {
        id: 0,
        principal_id: 0,
        name: detail.name,
        slug: detail.name,
        description: detail.description,
        license: detail.license,
        compatibility: detail.compatibility,
        // Carried across so a shipped skill's declaration is on screen here.
        allowed_tools: detail.allowed_tools,
        metadata: detail.metadata,
        body: detail.body,
        body_bytes: detail.body_bytes,
        provenance: 'human',
        created_by_user_id: 0,
        updated_by_user_id: 0,
        created_at: '',
        updated_at: '',
        files: detail.files,
        has_previous: false,
        previous_at: null,
        previous_by: null,
        warnings: detail.warnings,
        warning_count: detail.warnings.length,
    }
}

/** Whether `$name` is a shipped skill. Only the catalogue knows: no principal row, so it 404s. */
async function resolveShipped(skillName: string): Promise<PreShippedSkillSummary | null> {
    if (store.preShipped.length === 0 && !store.preShippedLoading) {
        await store.loadPreShippedSkills()
    }

    return store.preShipped.find((row) => row.name === skillName) ?? null
}

async function resolve(): Promise<void> {
    missing.value = false
    shipped.value = null
    if (name.value === '') return
    // Before any read: a child page's `onMounted` runs before the layout's, so on a cold deep link the
    // principal list has not landed and the read goes out with no `?principal_id=` — which the
    // contract resolves to the caller's own.
    await principals.ensureLoaded()
    // Gated on the principal, not just the name: a bare name key returns the *acting* principal's row,
    // and `unique(principal_id, name)` permits one name under two principals, so the desk would render
    // one principal's body under another's URL and a save would overwrite the other principal's row.
    const fromStore = store.skills.find(
        (s) => s.name === name.value && s.principal_id === principalId.value,
    )
    if (fromStore) {
        loaded.value = fromStore
        return
    }
    // A list reload is the only case that shortcut is for.
    try {
        loaded.value = await api.getSkill(name.value, principalId.value)
        return
    } catch {
        loaded.value = null
    }

    const catalogueEntry = await resolveShipped(name.value)
    if (catalogueEntry === null) {
        missing.value = true
        return
    }

    shipped.value = catalogueEntry
    try {
        loaded.value = deskShape(await preshippedApi.getPreShippedSkill(name.value))
    } catch {
        // Listed but not fetchable: better to say so than to show an empty desk.
        loaded.value = null
        missing.value = true
    }
}

// Same principal gate as `resolve()`: another principal's row must never become this desk.
watch(
    () => store.skills.find((s) => s.name === name.value && s.principal_id === principalId.value),
    (skill) => {
        if (skill) loaded.value = skill
    },
)

// A name change has to clear the save report: it names what the *previous* skill stores. The principal
// is watched alongside it — `unique(principal_id, name)` makes an identically-named skill on two
// principals a real collision, so `p/{pid}` alone changing is a different skill.
watch([name, routePrincipalId], () => {
    fileContents.value = {}
    savedDeclaration.value = undefined
    void resolve()
})

// Separate from the watcher above: `savedDeclaration` is declared below, so an `immediate`
// watcher would touch it before it exists.
onMounted(() => {
    fileContents.value = {}
    savedDeclaration.value = undefined
    void resolve()
})

async function loadSidecarFiles(skillName: string): Promise<void> {
    // The manifest comes from the row on screen, not a name-keyed lookup: this runs for a deep link
    // the store never listed, and a name-keyed read returns another principal's paths.
    const sidecars = (loaded.value?.files ?? []).filter((f) => f.path !== 'SKILL.md')

    // Read together, each with its own catch, so one unreadable file does not lose the rest.
    const contents = await Promise.all(
        sidecars.map(async (file) => {
            try {
                const content = await api.getSkillFile(skillName, file.path, principalId.value)
                return [file.path, content.content] as const
            } catch {
                // Left blank on a 413 over the 50 000-byte cap or a removal underneath: the manifest still
                // lists it, and the save-time error is the signal.
                return [file.path, ''] as const
            }
        }),
    )

    fileContents.value = Object.fromEntries(contents)
}

/** What the server holds as the declaration after the last save: `undefined` until one lands, then
 *  the string — or `null`, a save that *revoked* it. Set from the *response*, so the box reports
 *  only what was stored. */
const savedDeclaration = ref<string | null | undefined>(undefined)

/** The instance's tool registry, for telling a declared name from one this instance cannot resolve.
 *  `null` on a failed read, not `[]`: `[]` claims "no tools", which a failed read cannot support. */
const tools = ref<ToolSummary[] | null>(null)

onMounted(async () => {
    try {
        tools.value = await toolsApi.listTools()
    } catch {
        tools.value = null
    }
})

/** What this skill declares and which names resolve here — never whether an agent has them. */
const declaredTools = computed(() => declaredToolsSummary(tools.value, savedDeclaration.value))

const unavailableDeclared = computed(() => declaredTools.value.filter((row) => !row.available))

async function save(data: UpdateSkillDto): Promise<void> {
    try {
        const saved = await store.updateSkill(name.value, data)
        savedDeclaration.value = saved.allowed_tools
        store.setNotice(
            saved.warning_count > 0
                ? `Saved with ${plural(saved.warning_count, 'warning')} — they are listed above the file.`
                : null,
        )
    } catch {
        // `error` and `validationErrors` render in the layout and the desk.
    }
}

function restore(): void {
    void store
        .restoreSkill(name.value)
        .then((skill) => {
            savedDeclaration.value = skill.allowed_tools
            store.setNotice(`Restored the previous version of ${skill.name}.`)
        })
        .catch(() => {
            // `error` carries the message.
        })
}

/** Start from this shipped skill, via the create form: the shipped file belongs to the installation,
 *  so a copy is the first editable version — and the name is final, so an operator who has not read
 *  the body should not get a row for clicking a button. */
function duplicate(): void {
    const entry = shipped.value
    if (entry === null) return
    void router.push({ path: newSkillPath(principals.selectedPrincipalId), query: { template: entry.name } })
}
</script>

<template>
    <div class="flex min-h-0 flex-1 flex-col" data-test="desk-page">
        <p v-if="name === '' || missing" class="mx-auto w-full max-w-5xl px-6 py-10" data-test="desk-missing">
            <span class="text-sm text-muted-foreground">
                No skill named “{{ name }}” on this principal.
            </span>
            <RouterLink
                :to="{ path: homePath(principals.selectedPrincipalId) }"
                class="mt-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
                <ArrowLeft class="h-3.5 w-3.5" />
                Back to skills
            </RouterLink>
        </p>

        <template v-else-if="loaded">
            <!-- Persistent, not a toast: the names live in a collapsed checkbox group. `<output>`
                 because it reports rather than asks, and the element carries the status
                 semantics on every device where a `role="status"` div reaches only some. -->
            <output
                v-if="savedDeclaration !== undefined"
                class="shrink-0 border-b border-border bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground"
                data-test="declared-tools-summary"
            >
                <p v-if="declaredTools.length === 0" data-test="declared-tools-none">
                    Saved. This skill declares no tools.
                </p>
                <p v-else>
                    Saved. This skill declares
                    <span class="font-medium text-foreground" data-test="declared-tools-count">
                        {{ plural(declaredTools.length, 'tool') }}
                    </span>:
                    <span
                        v-for="row in declaredTools"
                        :key="row.name"
                        class="ml-1.5 inline-block"
                        :data-test="row.available ? 'declared-tool' : 'declared-tool-unavailable'"
                    >
                        <span class="font-mono font-medium text-foreground">{{ row.name }}</span>
                        <span v-if="!row.available" data-test="declared-tool-unavailable-note">
                            — not available on this instance
                        </span>
                    </span>
                </p>
                <p v-if="unavailableDeclared.length > 0" class="mt-0.5" data-test="declared-tools-unavailable-note">
                    {{ plural(unavailableDeclared.length, 'name') }}
                    {{ unavailableDeclared.length === 1 ? 'resolves' : 'resolve' }} to no tool
                    installed here. The declaration is kept as written.
                </p>
                <!-- Says what it does not know: a reader who just saved a declaration is exactly the person
                     who will assume it is live, and no route to the per-agent Tools page exists
                     from here. -->
                <p class="mt-0.5" data-test="declared-tools-scope">
                    This is a declaration only: Spora grants no pre-approval from it and enforces
                    nothing. Whether an agent has any of these tools is set per agent, not here.
                </p>
            </output>

            <SkillDesk
                :skill="loaded"
                :saving="store.saving"
                :validation-errors="store.validationErrors"
                :file-contents="fileContents"
                :principal-name="principals.currentPrincipal?.name ?? ''"
                :theme="hostContext?.theme"
                :read-only="shipped !== null"
                :shipped-source="shipped?.source ?? null"
                :tools="tools"
                @save="save"
                @delete="store.requestDelete"
                @restore="restore"
                @cancel="router.push({ path: homePath(principals.selectedPrincipalId) })"
                @load-files="loadSidecarFiles"
                @duplicate="duplicate"
            />
        </template>
    </div>
</template>
