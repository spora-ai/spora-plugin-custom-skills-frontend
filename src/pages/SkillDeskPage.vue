<script setup lang="ts">
/**
 * `/skills/:name` — the writing surface for one principal-scoped skill.
 *
 * The route names the skill and nothing about whose it is, so a scope change from
 * the bar navigates to home rather than re-pointing this URL at another
 * principal's identically-named skill mid-edit.
 *
 * It also owns the two things the desk cannot: the instance's tool registry, which
 * only a page can read once, and the post-save declaration box, which needs the
 * saved response to say anything true. The box is declaration-only on purpose —
 * this page has no agent context, so the activation gap is the host's per-agent
 * Tools page to report.
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

const route = useRoute()
const router = useRouter()
const store = useSkillsStore()
const principals = usePrincipalsStore()
const hostContext = inject<PluginHostContext>(HOST_CONTEXT_KEY)

const name = computed(() => {
    const param = route.params.name
    return typeof param === 'string' ? param : ''
})

/** Null while the resource is being read, and stays null when there is no such skill. */
const loaded = ref<CustomSkillResource | null>(null)
const missing = ref(false)
const fileContents = ref<Record<string, string>>({})
/** Non-null when this name belongs to the host catalogue rather than a principal. */
const shipped = ref<PreShippedSkillSummary | null>(null)

/**
 * A shipped skill has no row on any principal, so the fields the desk reads
 * that only exist for stored skills are filled with placeholders. Read-only mode
 * never reads them: there is no save, no delete and no restore, and the desk
 * shows the source rather than the principal.
 */
function deskShape(detail: PreShippedSkillDetail): CustomSkillResource {
    return {
        id: 0,
        principal_id: 0,
        name: detail.name,
        slug: detail.name,
        description: detail.description,
        license: detail.license,
        compatibility: detail.compatibility,
        // Carried across so a shipped skill's declaration is on screen here rather
        // than only in the host's own tools page, which cannot be edited anyway.
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

/**
 * Whether `$name` is a shipped skill, loading the catalogue if it has not landed.
 *
 * The host catalogue is the only thing that knows: a shipped skill has no
 * principal row, so the custom-skills read 404s for a name that very much
 * exists, and answering "no skill by that name" for it is the confusing case
 * worth avoiding.
 */
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
    const fromStore = store.skillsByName[name.value]
    if (fromStore) {
        loaded.value = fromStore
        return
    }
    // A deep link, or a principal whose list has not landed yet. The contract has
    // a per-skill read, so a miss here is a real 404 rather than a stale list.
    try {
        loaded.value = await api.getSkill(name.value, principals.selectedPrincipalId)
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
        // The summary listed it and the detail did not come back. Saying it is
        // missing is better than an empty desk that looks like a broken skill.
        loaded.value = null
        missing.value = true
    }
}

watch(name, () => {
    fileContents.value = {}
    void resolve()
}, { immediate: true })

watch(
    () => store.skillsByName[name.value],
    (skill) => {
        if (skill) loaded.value = skill
    },
)

async function loadSidecarFiles(skillName: string): Promise<void> {
    const sidecars = (store.skillsByName[skillName]?.files ?? []).filter((f) => f.path !== 'SKILL.md')

    // Read together rather than one at a time. A skill holds at most a couple of
    // dozen sidecars, and the sequential version made opening a skill with
    // references cost one round trip per file before the editor was usable.
    // Each read keeps its own catch, so one unreadable file does not lose the rest.
    const contents = await Promise.all(
        sidecars.map(async (file) => {
            try {
                const content = await api.getSkillFile(skillName, file.path, principals.selectedPrincipalId)
                return [file.path, content.content] as const
            } catch {
                // A sidecar that cannot be read (413 over the 50 000-byte cap, or
                // removed underneath us) is left blank: the manifest still lists it, and
                // the save-time error is the real signal.
                return [file.path, ''] as const
            }
        }),
    )

    fileContents.value = Object.fromEntries(contents)
}

/**
 * What the server holds as the declaration, after the last successful save.
 *
 * Two states, not one: `undefined` until a save has landed, then the string — or
 * `null`, which is a save that *revoked* the declaration and is exactly the case
 * worth saying out loud. Collapsing them would leave a revocation silent.
 *
 * Set from the *response* rather than the draft, so the box can only ever report
 * what was actually stored. Untouched by a rejection, for the same reason.
 */
const savedDeclaration = ref<string | null | undefined>(undefined)

/**
 * The instance's tool registry, for the declared-tools group and for telling a
 * declared name from one this instance cannot resolve.
 *
 * Read once per page, and left `null` when the read fails rather than defaulted to
 * `[]`. The registry is an aid, so a failure must not error the desk — but `[]` is a
 * claim ("this instance has no tools") that a failed read cannot support, and the
 * group would then report every declaration as unresolvable. `null` is "we could not
 * ask", and the group degrades to the stored names with none of them marked.
 */
const tools = ref<ToolSummary[] | null>(null)

onMounted(async () => {
    try {
        tools.value = await toolsApi.listTools()
    } catch {
        tools.value = null
    }
})

/**
 * The post-save readout: what this skill declares, and which of those names this
 * instance can resolve.
 *
 * Declaration-only, and it has to be. This page has no agent context, so it cannot
 * know whether any of these tools is activated for any agent, and saying so would be
 * a claim the surface cannot support. The activation gap belongs to the host's
 * per-agent Tools page, which does have that context — so the two boxes stay
 * separate rather than either pointing at the other.
 */
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
        // `error` and `validationErrors` render in the layout and the desk, so the
        // buffer and the cursor survive a rejection.
    }
}

function restore(): void {
    void store
        .restoreSkill(name.value)
        .then((skill) => {
            store.setNotice(`Restored the previous version of ${skill.name}.`)
        })
        .catch(() => {
            // `error` carries the message; the store re-throws after setting it.
        })
}

/**
 * Start from this shipped skill, via the create form.
 *
 * The only way forward from a read-only desk: the shipped file belongs to the
 * installation, so a copy is the first editable version of it. The form takes it
 * as a template rather than writing the copy here — the name is final, and an
 * operator who has not seen the body yet should not get a row on the principal
 * because they clicked a button. The create page carries what it can and states
 * what the host will not serve: the sidecars.
 */
function duplicate(): void {
    const entry = shipped.value
    if (entry === null) return
    void router.push({ path: '/new', query: { template: entry.name } })
}
</script>

<template>
    <div class="flex min-h-0 flex-1 flex-col" data-test="desk-page">
        <p v-if="name === '' || missing" class="mx-auto w-full max-w-5xl px-6 py-10" data-test="desk-missing">
            <span class="text-sm text-muted-foreground">
                No skill named “{{ name }}” on this principal.
            </span>
            <RouterLink
                :to="{ path: '/' }"
                class="mt-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
                <ArrowLeft class="h-3.5 w-3.5" />
                Back to skills
            </RouterLink>
        </p>

        <template v-else-if="loaded">
            <!--
            Persistent, not a toast. A toast is gone before a declaration has been
            read, and this is the one thing about the save an operator cannot
            re-derive from the form they just filled in: the names are in a
            collapsed checkbox group, and a name this instance cannot resolve is
            only knowable against the registry.

            `<output>` because this is a confirmation, not an interruption — it
            reports rather than asks, and the desk stays usable underneath. The
            element carries the status semantics on every device; a `role="status"`
            div reaches only the subset of assistive tech that honours ARIA roles.
        -->
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
                <!--
                Deliberately says what it does not know. This page has no agent
                context, so it cannot say whether any of these tools is activated
                anywhere, and a reader who just saved a declaration is exactly the
                person who will assume it is live. The activation gap is the host's
                per-agent Tools page to report, and no route to it exists from here.
            -->
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
                @cancel="router.push({ path: '/' })"
                @load-files="loadSidecarFiles"
                @duplicate="duplicate"
            />
        </template>
    </div>
</template>
