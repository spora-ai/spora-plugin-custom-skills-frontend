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
import { useSkillsStore } from '../stores/skills'
import { HOST_CONTEXT_KEY, type PluginHostContext } from '../shims'
import type { PreShippedSkillDetail } from '../types'

const route = useRoute()
const router = useRouter()
const store = useSkillsStore()
const hostContext = inject<PluginHostContext>(HOST_CONTEXT_KEY)

const name = computed(() => {
    const param = route.params.name
    return typeof param === 'string' ? param : ''
})

const detail = ref<PreShippedSkillDetail | null>(null)
const loading = ref(false)
const failed = ref(false)

async function resolve(): Promise<void> {
    detail.value = null
    failed.value = false
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

async function duplicate(): Promise<void> {
    const summary = store.preShipped.find((s) => s.name === name.value)
    if (!summary) return
    try {
        const created = await store.duplicateShippedSkill(summary)
        await router.push({ path: `/skills/${created.name}` })
    } catch {
        // `error` carries the message.
    }
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
            contents-unavailable
            :theme="hostContext?.theme"
            @close="router.push({ path: '/library' })"
            @duplicate="duplicate"
        />
    </div>
</template>
