<script setup lang="ts">
/**
 * Home: what this principal owns, and the two ways to change that.
 *
 * Not a dashboard of everything: the catalogue is a different scope (global,
 * read-only) and mixing it in here would make the page lie about what the current
 * principal governs. It gets its own tab.
 *
 * The heading names the principal because on a page you scroll, the scope bar
 * scrolls out of reach, and the heading is the last thing that should be ambiguous
 * about whose skills you are reading.
 */
import { computed, ref } from 'vue'
import { ChevronRight, Layers, Plus } from 'lucide-vue-next'
import SkillRow from '../components/SkillRow.vue'
import SkillSortSelect from '../components/SkillSortSelect.vue'
import { useSkillsStore } from '../stores/skills'
import { usePrincipalsStore } from '../stores/principals'
import {
    HOME_SORT_OPTIONS,
    principalScopeBlurb,
    sortSkills,
    type SkillSort,
} from '../lib/skillFormat'

const store = useSkillsStore()
const principals = usePrincipalsStore()

const sort = ref<SkillSort>('updated')

const principal = computed(() => principals.currentPrincipal)
const rows = computed(() => sortSkills(store.skills, sort.value))

// The three store calls below re-throw after setting `error`, so each needs a
// catch: `void` alone satisfies no-floating-promises while leaving the rejection
// unhandled. The banner shows the message either way.
function enable(name: string, agentId: number): void {
    void store.enableOnAgent(name, agentId).catch(() => {})
}

function disable(name: string, agentId: number): void {
    void store.disableOnAgent(name, agentId).catch(() => {})
}

function restore(name: string): void {
    void store
        .restoreSkill(name)
        .then((skill) => {
            store.setNotice(`Restored the previous version of ${skill.name}.`)
        })
        .catch(() => {})
}
</script>

<template>
    <div class="mx-auto w-full max-w-5xl px-6 py-8" data-test="home-page">
        <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0">
                <h2 class="text-2xl font-semibold tracking-tight" data-test="home-principal">
                    {{ principal?.name ?? 'No principal selected' }}
                </h2>
                <p class="mt-1 text-sm text-muted-foreground" data-test="home-scope-blurb">
                    {{ principalScopeBlurb(principal) }}
                </p>
            </div>

            <!-- The discoverable half of duplication. A button that says
                 "duplicate" cannot help you decide; this one points at the reading. -->
            <RouterLink
                :to="{ path: '/library' }"
                class="group inline-flex items-center gap-3 rounded-lg border border-border px-3.5 py-2.5 transition-colors hover:bg-muted/50"
                data-test="home-catalogue-link"
            >
                <span class="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-background">
                    <Layers class="h-4 w-4" />
                </span>
                <span class="text-left">
                    <span class="block text-sm font-medium">Start from a shipped skill</span>
                    <span class="block text-[11px] text-muted-foreground">
                        {{ store.preShipped.length }} skills to read and copy
                    </span>
                </span>
                <ChevronRight class="ml-1 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </RouterLink>
        </div>

        <section class="mt-8">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-baseline gap-2">
                    <h3 class="text-sm font-semibold">All skills</h3>
                    <span class="text-xs text-muted-foreground" data-test="home-count">
                        {{ store.skills.length }} in {{ principal?.name ?? 'this principal' }}
                    </span>
                </div>
                <SkillSortSelect id="skill-sort" v-model="sort" :options="HOME_SORT_OPTIONS" />
            </div>

            <p
                v-if="store.loading && store.skills.length === 0"
                class="mt-3 text-sm text-muted-foreground"
                data-test="home-loading"
            >
                Loading your skills…
            </p>

            <!--
                Empty state for a principal with nothing in it yet: every group's
                first visit, and every new user's second. It leads with creation and
                points at the catalogue second, because an empty scope is a prompt,
                not an error state — no red, no apology.
            -->
            <div
                v-else-if="store.skills.length === 0"
                class="mt-8 rounded-xl border border-dashed border-border px-6 py-12 text-center"
                data-test="home-empty"
            >
                <h4 class="text-sm font-semibold">No skills yet</h4>
                <p class="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                    <template v-if="principal?.type === 'user'">
                        Skills you write here are yours alone. To adapt one that already
                        exists, copy it from the catalogue instead of starting over.
                    </template>
                    <template v-else>
                        This group has no skills yet. Anyone in the group can write one;
                        writing needs to be an owner or an admin.
                    </template>
                </p>
                <div class="mt-5 flex flex-wrap items-center justify-center gap-2">
                    <RouterLink
                        :to="{ path: '/new' }"
                        class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                        data-test="home-empty-new"
                    >
                        <Plus class="h-4 w-4" />
                        New skill
                    </RouterLink>
                    <RouterLink
                        :to="{ path: '/library' }"
                        class="inline-flex h-9 items-center rounded-lg border border-border px-3.5 text-sm font-medium transition-colors hover:bg-muted"
                        data-test="home-empty-catalogue"
                    >
                        Browse the catalogue
                    </RouterLink>
                </div>
            </div>

            <ul
                v-else
                class="mt-3 overflow-hidden rounded-xl border border-border [&>li]:border-b [&>li]:last:border-b-0"
                data-test="skill-list"
            >
                <SkillRow
                    v-for="skill in rows"
                    :key="skill.name"
                    :skill="skill"
                    :allowlist="store.allowlistFor(skill.name)"
                    :allowlist-loaded="skill.name in store.allowlists"
                    :agents="store.agents"
                    :busy="store.saving"
                    @delete="store.requestDelete"
                    @restore="restore"
                    @load-allowlist="store.loadAllowlist"
                    @enable="enable"
                    @disable="disable"
                />
            </ul>
        </section>
    </div>
</template>
