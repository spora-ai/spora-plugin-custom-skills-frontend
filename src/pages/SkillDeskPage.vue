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
import { useSkillsStore } from '../stores/skills'
import { usePrincipalsStore } from '../stores/principals'
import { HOST_CONTEXT_KEY, type PluginHostContext } from '../shims'
import type { CustomSkillResource, UpdateSkillDto } from '../types'

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

async function resolve(): Promise<void> {
    missing.value = false
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
    } catch {
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
    const contents: Record<string, string> = {}
    for (const file of store.skillsByName[skillName]?.files ?? []) {
        if (file.path === 'SKILL.md') continue
        try {
            const content = await api.getSkillFile(skillName, file.path, principals.selectedPrincipalId)
            contents[file.path] = content.content
        } catch {
            // A sidecar that cannot be read (413 over the 50 000-byte cap, or
            // removed underneath us) is left blank: the manifest still lists it, and
            // the save-time error is the real signal.
            contents[file.path] = ''
        }
    }
    fileContents.value = contents
}

async function save(data: UpdateSkillDto): Promise<void> {
    try {
        const saved = await store.updateSkill(name.value, data)
        store.setNotice(
            saved.warning_count > 0
                ? `Saved with ${saved.warning_count} warning${saved.warning_count === 1 ? '' : 's'} — they are listed above the file.`
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
            @save="save"
            @delete="store.requestDelete"
            @restore="restore"
            @cancel="router.push({ path: '/' })"
            @load-files="loadSidecarFiles"
        />
    </div>
</template>
