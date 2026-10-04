<script setup lang="ts">
/**
 * `/library/:name` — read one shipped skill. A separate route from
 * `/skills/:name`, not a `?view=` query on it: a shipped skill is a global,
 * read-only resource and a custom skill is a principal-scoped, writable one, and
 * the two having different URLs makes that difference visible instead of hiding it
 * behind a query string.
 */
import { computed, inject, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'
import SkillViewer from '../components/SkillViewer.vue'
import * as preshippedApi from '../api/preshippedSkills'
import { HOST_CONTEXT_KEY, type PluginHostContext } from '../shims'
import type { PreShippedSkillDetail } from '../types'

const route = useRoute()
const router = useRouter()
const hostContext = inject<PluginHostContext>(HOST_CONTEXT_KEY)

const name = computed(() => {
    const param = route.params.name
    return typeof param === 'string' ? param : ''
})

const detail = ref<PreShippedSkillDetail | null>(null)
const loading = ref(false)
const failed = ref(false)

/**
 * Sidecar contents, fetched one at a time as they are opened.
 *
 * The detail endpoint lists `files` as `{path, bytes}` and inlines only the
 * `SKILL.md` body, so nothing else was fetchable and the preview could only ever
 * show markdown. That was not a rendering limit — it was a missing endpoint, and
 * `GET /api/v1/skills/{slug}/files/{path}` now exists.
 *
 * Per file rather than all at once, for the same reason the desk does it: a skill
 * with a dozen sidecars should not transfer a dozen files to show one, and a file
 * over the 50 KB cap should fail on its own rather than take the read with it.
 */
const fileContents = ref<Record<string, string>>({})
/** Paths the host answered no for — missing, or over the cap. */
const unavailablePaths = ref<string[]>([])

async function loadFile(skillName: string, path: string): Promise<void> {
    try {
        const file = await preshippedApi.getPreShippedSkillFile(skillName, path)
        fileContents.value = { ...fileContents.value, [path]: file.content }
    } catch {
        unavailablePaths.value = [...unavailablePaths.value, path]
    }
}

async function resolve(): Promise<void> {
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
    void router.push({ path: '/new', query: { template: name.value } })
}
</script>

<template>
    <div class="mx-auto w-full max-w-5xl px-6 py-8" data-test="viewer-page">
        <RouterLink
            :to="{ path: '/library' }"
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
