<script setup lang="ts">
/**
 * `/p/{principalId}/library/:name` — read one shipped skill. A separate route from
 * `/p/{principalId}/skill/:name`, not a `?view=` query on it: a shipped skill is a
 * global, read-only resource and a custom skill is a principal-scoped, writable one,
 * and the two having different URLs makes that difference visible instead of hiding
 * it behind a query string.
 *
 * The principal rides along even though the skill it shows does not need one — the
 * scope is what _Duplicate_ writes the copy onto, so a viewer link that dropped it
 * would fork onto whichever principal the next reload defaulted to.
 */
import { computed, inject, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'
import SkillViewer from '../components/SkillViewer.vue'
import * as preshippedApi from '../api/preshippedSkills'
import { usePrincipalsStore } from '../stores/principals'
import { libraryPath, newSkillPath } from '../lib/paths'
import { HOST_CONTEXT_KEY, type PluginHostContext } from '../shims'
import type { PreShippedSkillDetail } from '../types'

const route = useRoute()
const router = useRouter()
const principals = usePrincipalsStore()
const hostContext = inject<PluginHostContext>(HOST_CONTEXT_KEY)

const principalId = computed(() => principals.selectedPrincipalId)

const name = computed(() => {
    const param = route.params.name
    return typeof param === 'string' ? param : ''
})

const detail = ref<PreShippedSkillDetail | null>(null)
const loading = ref(false)
const failed = ref(false)

/** Fetched one at a time as opened, so a dozen sidecars do not transfer to show one. */
const fileContents = ref<Record<string, string>>({})
const unavailablePaths = ref<string[]>([])

// Bumped per resolve(), so a read still in flight for the previous skill cannot
// land in the next one's map — two skills sharing a sidecar path would otherwise
// render the old skill's bytes under the new skill's name, permanently.
let epoch = 0

async function loadFile(skillName: string, path: string): Promise<void> {
    const mine = epoch
    try {
        const file = await preshippedApi.getPreShippedSkillFile(skillName, path)
        if (mine !== epoch) return
        // Otherwise the viewer waits on a path it already asked for, for ever.
        if (typeof file?.content !== 'string') {
            unavailablePaths.value = [...unavailablePaths.value, path]
            return
        }
        fileContents.value = { ...fileContents.value, [path]: file.content }
    } catch {
        if (mine !== epoch) return
        unavailablePaths.value = [...unavailablePaths.value, path]
    }
}

async function resolve(): Promise<void> {
    epoch += 1
    detail.value = null
    failed.value = false
    fileContents.value = {}
    unavailablePaths.value = []
    if (name.value === '') return
    loading.value = true
    try {
        detail.value = await preshippedApi.getPreShippedSkill(name.value)
    } catch {
        failed.value = true
    } finally {
        loading.value = false
    }
}

watch(name, () => {
    void resolve()
}, { immediate: true })

/**
 * Start from this shipped skill, via the create form.
 *
 * Same reasoning as the desk's Duplicate and the catalogue's: one word, one
 * meaning. The form takes the skill as a template, so the operator names the copy
 * before anything is written, and the create page states which sidecars the host
 * will not serve.
 */
function duplicate(): void {
    void router.push({ path: newSkillPath(principalId.value), query: { template: name.value } })
}
</script>

<template>
    <div class="mx-auto w-full max-w-5xl px-6 py-8" data-test="viewer-page">
        <RouterLink
            :to="{ path: libraryPath(principalId) }"
            class="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            data-test="viewer-back"
        >
            <ArrowLeft class="h-3.5 w-3.5" />
            Back to the catalogue
        </RouterLink>

        <p
            v-if="loading"
            class="mt-6 text-sm text-muted-foreground"
            data-test="viewer-loading"
        >
            Loading {{ name }}…
        </p>

        <p
            v-else-if="failed"
            class="mt-6 text-sm text-muted-foreground"
            data-test="viewer-failed"
        >
            The host has no skill named “{{ name }}”.
        </p>

        <SkillViewer
            v-else-if="detail"
            :shipped="detail"
            :file-contents="fileContents"
            :unavailable-paths="unavailablePaths"
            :theme="hostContext?.theme"
            @load-file="loadFile"
            @duplicate="duplicate"
        />
    </div>
</template>
