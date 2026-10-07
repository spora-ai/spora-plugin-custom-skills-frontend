<script setup lang="ts">
/**
 * `/library` — every skill the host ships. Global and read-only by contract ("Not
 * endpoints (deliberately)": this plugin must never re-serve them), so the only
 * way out of a row is *Duplicate*, which opens the create form with this skill as
 * a template — nothing is written until the operator names it and presses create.
 *
 * Grouped by `source`, the field the host catalogue carries, because that is the
 * only way a reader can tell a core skill from one a plugin shipped.
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AlertTriangle, Copy, Eye, FileText, Package } from 'lucide-vue-next'
import SkillSortSelect from '../components/SkillSortSelect.vue'
import { useSkillsStore } from '../stores/skills'
import { usePrincipalsStore } from '../stores/principals'
import { CATALOGUE_SORT_OPTIONS, sortByName, type NameSort } from '../lib/skillFormat'
import { newSkillPath, viewerPath } from '../lib/paths'
import type { PreShippedSkillSummary } from '../types'

const store = useSkillsStore()
const principals = usePrincipalsStore()
const router = useRouter()

const sort = ref<NameSort>('name-asc')

/**
 * The acting principal, which every link below carries.
 *
 * A shipped skill has no owner, but the panel's *acting* principal is what _Duplicate_
 * writes the copy onto — so it has to travel in the link even though the skill it
 * opens does not need it. Leaving it off would make a copy land on whichever
 * principal the next reload happened to default to.
 */
const principalId = computed(() => principals.selectedPrincipalId)

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

/**
 * "Duplicate" means "start from this", not "copy this now".
 *
 * It used to POST a copy and land on the desk, which wrote a row before the
 * operator had named it or read it — and the name is final, so a copy written on
 * their behalf is a copy they then have to delete. The create form takes the
 * shipped skill as a template instead: the name is theirs to pick, nothing is
 * written until they press create, and what comes across is visible first.
 */
function duplicate(skill: PreShippedSkillSummary): void {
    void router.push({ path: newSkillPath(principalId.value), query: { template: skill.name } })
}
</script>

<template>
    <div class="mx-auto w-full max-w-5xl px-6 py-8" data-test="catalogue-page">
        <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0">
                <h2 class="text-2xl font-semibold tracking-tight">Catalogue</h2>
                <p class="mt-1 max-w-xl text-sm text-muted-foreground">
                    Every skill the host ships, whatever the plugin. Read one, then start from it to make
                    it yours — a shipped name is reserved, so a copy is always renamed.
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
                    <!--
                        A grid, not a flex row, and that is the whole fix for the
                        alignment. In flex each row sized its own columns, so a row
                        with a licence pushed the buttons left of a row without one
                        and nothing lined up down the column. A grid sizes each column
                        once for the whole list. `items-center` then centres the meta
                        and the actions against the two-line name + description, which
                        `items-start` had left hugging the first line.

                        The `hidden` on the meta column is gone with the `sm:flex`: the
                        breakpoint now moves it onto its own row instead of dropping
                        it, so a narrow window shows the file count rather than nothing.
                    -->
                    <li
                        v-for="skill in group.items"
                        :key="skill.name"
                        class="grid grid-cols-1 items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                        data-test="shipped-row"
                    >
                        <div class="min-w-0">
                            <div class="flex flex-wrap items-center gap-2">
                                <RouterLink
                                    :to="{ path: viewerPath(principalId, skill.name) }"
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

                        <div
                            class="flex items-center gap-4 text-xs text-muted-foreground"
                            data-test="shipped-meta"
                        >
                            <span class="inline-flex items-center gap-1">
                                <FileText class="h-3.5 w-3.5" />
                                {{ skill.files_count }}
                                {{ skill.files_count === 1 ? 'file' : 'files' }}
                            </span>
                            <span v-if="skill.license" class="font-mono">{{ skill.license }}</span>
                        </div>

                        <div class="flex items-center gap-1.5">
                            <RouterLink
                                :to="{ path: viewerPath(principalId, skill.name) }"
                                class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium transition-colors hover:bg-muted"
                                data-test="view-shipped"
                            >
                                <Eye class="h-3.5 w-3.5" />
                                Read
                            </RouterLink>
                            <button
                                type="button"
                                class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
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
