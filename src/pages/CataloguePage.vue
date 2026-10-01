<script setup lang="ts">
/**
 * `/library` — every skill the host ships. Global and read-only by contract ("Not
 * endpoints (deliberately)": this plugin must never re-serve them), so the only
 * way out of a row is *Duplicate*, which writes a copy onto the acting principal.
 *
 * Grouped by `source`, the field the host catalogue carries, because that is the
 * only way a reader can tell a core skill from one a plugin shipped.
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AlertTriangle, Copy, Eye, FileText, Package } from 'lucide-vue-next'
import SkillSortSelect from '../components/SkillSortSelect.vue'
import { useSkillsStore } from '../stores/skills'
import { CATALOGUE_SORT_OPTIONS, sortByName, type NameSort } from '../lib/skillFormat'
import type { PreShippedSkillSummary } from '../types'

const store = useSkillsStore()
const router = useRouter()

const sort = ref<NameSort>('name-asc')

const groups = computed(() => {
    const bySource = new Map<string, PreShippedSkillSummary[]>()
    for (const skill of store.preShipped) {
        const bucket = bySource.get(skill.source)
        if (bucket) bucket.push(skill)
        else bySource.set(skill.source, [skill])
    }
    return [...bySource.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([source, items]) => ({ source, items: sortByName(items, sort.value) }))
})

async function duplicate(skill: PreShippedSkillSummary): Promise<void> {
    try {
        const created = await store.duplicateShippedSkill(skill)
        await router.push({ path: `/skills/${created.name}` })
    } catch {
        // `error` carries the message.
    }
}
</script>

<template>
    <div class="mx-auto w-full max-w-5xl px-6 py-8" data-test="catalogue-page">
        <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0">
                <h2 class="text-2xl font-semibold tracking-tight">Catalogue</h2>
                <p class="mt-1 max-w-xl text-sm text-muted-foreground">
                    Every skill the host ships, whatever the plugin. Read one, then copy it to make it
                    yours — a shipped name is reserved, so a copy is always renamed.
                </p>
            </div>
            <SkillSortSelect id="library-sort" v-model="sort" :options="CATALOGUE_SORT_OPTIONS" />
        </div>

        <p
            v-if="store.preShippedLoading && store.preShipped.length === 0"
            class="mt-8 text-sm text-muted-foreground"
            data-test="catalogue-loading"
        >
            Loading the host catalogue…
        </p>

        <div
            v-else-if="store.preShipped.length === 0"
            class="mt-8 rounded-xl border border-dashed border-border px-6 py-12 text-center"
            data-test="catalogue-empty"
        >
            <h3 class="text-sm font-semibold">This host ships no skills</h3>
            <p class="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                The catalogue is served by the host at <code class="font-mono">/api/v1/skills</code>.
                Install a plugin that registers skills, or write your own.
            </p>
        </div>

        <div v-else class="mt-8 space-y-6">
            <section v-for="group in groups" :key="group.source">
                <h3
                    class="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    data-test="source-group"
                >
                    {{ group.source }} · {{ group.items.length }}
                </h3>
                <ul
                    class="mt-2 overflow-hidden rounded-xl border border-border [&>li]:border-b [&>li]:last:border-b-0"
                >
                    <li
                        v-for="skill in group.items"
                        :key="skill.name"
                        class="flex items-start gap-4 px-4 py-3 transition-colors hover:bg-muted/40"
                        data-test="shipped-row"
                    >
                        <div class="min-w-0 flex-1">
                            <div class="flex flex-wrap items-center gap-2">
                                <RouterLink
                                    :to="{ path: `/library/${skill.name}` }"
                                    class="truncate font-mono text-sm font-medium hover:underline"
                                    data-test="preshipped-name"
                                >
                                    {{ skill.name }}
                                </RouterLink>
                                <span
                                    v-if="skill.has_warnings"
                                    class="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-500/25"
                                    data-test="preshipped-warnings"
                                >
                                    <AlertTriangle class="h-3 w-3" />
                                    has warnings
                                </span>
                            </div>
                            <p class="mt-0.5 truncate text-sm text-muted-foreground">
                                {{ skill.description || 'No description.' }}
                            </p>
                        </div>

                        <div class="hidden shrink-0 items-center gap-4 text-xs text-muted-foreground sm:flex">
                            <span class="inline-flex items-center gap-1">
                                <FileText class="h-3.5 w-3.5" />
                                {{ skill.files_count }}
                                {{ skill.files_count === 1 ? 'file' : 'files' }}
                            </span>
                            <span v-if="skill.license" class="font-mono">{{ skill.license }}</span>
                        </div>

                        <div class="flex shrink-0 items-center gap-1.5">
                            <RouterLink
                                :to="{ path: `/library/${skill.name}` }"
                                class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium transition-colors hover:bg-muted"
                                data-test="view-shipped"
                            >
                                <Eye class="h-3.5 w-3.5" />
                                Read
                            </RouterLink>
                            <button
                                type="button"
                                :disabled="store.saving"
                                class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                                data-test="duplicate-skill"
                                @click="duplicate(skill)"
                            >
                                <Copy class="h-3.5 w-3.5" />
                                Duplicate
                            </button>
                        </div>
                    </li>
                </ul>
            </section>

            <p class="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Package class="h-3.5 w-3.5" />
                Served by the host at <code class="font-mono">/api/v1/skills</code> — read-only here.
            </p>
        </div>
    </div>
</template>
