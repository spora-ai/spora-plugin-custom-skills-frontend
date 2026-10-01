<script setup lang="ts">
/**
 * `/skills/:name` — the writing surface for one principal-scoped skill.
 *
 * The route names the skill and nothing about whose it is, so a scope change from
 * the bar navigates to home rather than re-pointing this URL at another
 * principal's identically-named skill mid-edit.
 */
import { computed, inject, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'
import SkillDesk from '../components/SkillDesk.vue'
import * as api from '../api/customSkills'
import * as preshippedApi from '../api/preshippedSkills'
import { useSkillsStore } from '../stores/skills'
import { usePrincipalsStore } from '../stores/principals'
import { HOST_CONTEXT_KEY, type PluginHostContext } from '../shims'
import type {
    CustomSkillResource,
    PreShippedSkillDetail,
    PreShippedSkillSummary,
    UpdateSkillDto,
} from '../types'
import { plural } from '../lib/skillFormat'

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

async function save(data: UpdateSkillDto): Promise<void> {
    try {
        const saved = await store.updateSkill(name.value, data)
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
    void store.restoreSkill(name.value).then((skill) => {
        store.setNotice(`Restored the previous version of ${skill.name}.`)
    })
}

/**
 * Fork a shipped skill onto the selected principal and go to the new copy.
 *
 * The only way forward from a read-only desk: the shipped file belongs to the
 * installation, so the copy is the first editable version of it. The store's
 * notice already covers what could not be carried over — the host serves no
 * per-file read for a shipped skill, so its sidecars have to be re-added.
 */
function duplicate(): void {
    const entry = shipped.value
    if (entry === null) return
    void store.duplicateShippedSkill(entry).then((created) => {
        void router.push({ path: `/skills/${created.name}` })
    })
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

        <SkillDesk
            v-else-if="loaded"
            :skill="loaded"
            :saving="store.saving"
            :validation-errors="store.validationErrors"
            :file-contents="fileContents"
            :principal-name="principals.currentPrincipal?.name ?? ''"
            :theme="hostContext?.theme"
            :read-only="shipped !== null"
            :shipped-source="shipped?.source ?? null"
            @save="save"
            @delete="store.requestDelete"
            @restore="restore"
            @cancel="router.push({ path: '/' })"
            @load-files="loadSidecarFiles"
            @duplicate="duplicate"
        />
    </div>
</template>
