<script setup lang="ts">
/**
 * The panel's one piece of global state, made visible.
 *
 * A dropdown, not a chip row: equal-weight chips read as *filters*, and a filter does not say
 * "everything below this belongs to what I picked". The per-entry skill count is what makes it a
 * scope — you can see the shape of each before committing to it.
 *
 * **No search box, deliberately.** A ⌘K palette already covers agents, groups and chats, and a second
 * search box here would only ever see the *selected* principal's skills: two boxes that disagree,
 * this one strictly narrower.
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check, ChevronDown, Plus, Users } from 'lucide-vue-next'
import { useSkillsStore } from '../stores/skills'
import { usePrincipalsStore } from '../stores/principals'
import { homePath, libraryPath, newSkillPath } from '../lib/paths'
import { isLibraryPath } from '../lib/hostRoute'
import type { Principal } from '../api/principals'

const principals = usePrincipalsStore()
const store = useSkillsStore()
const route = useRoute()
const router = useRouter()

const open = ref(false)

const selected = computed<Principal | null>(() => principals.currentPrincipal)

const principalId = computed(() => principals.selectedPrincipalId)

const skillsPath = computed(() => homePath(principalId.value))
const cataloguePath = computed(() => libraryPath(principalId.value))
const newPath = computed(() => newSkillPath(principalId.value))

const section = computed(() => (isLibraryPath(route.path) ? 'library' : 'skills'))

/** A type glyph rather than an avatar: the host has no portrait for a principal. */
function initials(name: string): string {
    return name
        .split(/\s+/)
        .filter((part) => /[a-z0-9]/i.test(part))
        .slice(0, 2)
        // `[...part][0]`, not `charAt(0)`: a word can pass the filter above on an ASCII letter while
        // *starting* with an astral one ("🚀 Team"), and `charAt` indexes UTF-16 units.
        .map((part) => [...part][0]!.toUpperCase())
        .join('')
}

function isUser(principal: Principal): boolean {
    return principal.type === 'user'
}

/** `/principals/me` carries no membership role, so the read/write split is stated once. */
function sublabel(principal: Principal): string {
    return isUser(principal) ? 'Personal' : 'Group'
}

function countFor(id: number): number | null {
    return store.principalSkillCounts[id] ?? null
}

function openMenu(): void {
    open.value = true
    for (const principal of principals.principals) {
        if (!(principal.id in store.principalSkillCounts)) {
            void store.loadPrincipalSkillCount(principal.id)
        }
    }
}

/**
 * A scope change navigates — it does not mutate the store. The path is the only writer of the acting
 * principal, and two writers would leave path and store disagreeing.
 *
 * Home, not the current page: `unique(principal_id, name)` makes another principal's identically-named
 * skill a real collision, and re-pointing a desk mid-edit is the worst outcome the routing enables.
 */
async function choose(id: number): Promise<void> {
    open.value = false
    await router.push({ path: homePath(id) })
}

// Also needed for a scope change arriving as a host navigation, which skips `choose()`.
watch(
    () => principals.selectedPrincipalId,
    () => {
        open.value = false
    },
)
</script>

<template>
    <div
        class="sticky top-0 z-30 flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80"
        data-test="principal-scope"
    >
        <div class="relative">
            <button
                type="button"
                class="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background pl-1.5 pr-2.5 text-sm transition-colors hover:bg-muted/50"
                aria-haspopup="menu"
                :aria-expanded="open"
                data-test="scope-toggle"
                @click="open ? (open = false) : openMenu()"
            >
                <span
                    v-if="selected && isUser(selected)"
                    class="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-[11px] font-semibold text-primary-foreground"
                >
                    {{ selected ? initials(selected.name) : '' }}
                </span>
                <span
                    v-else
                    class="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground"
                >
                    <Users class="h-3.5 w-3.5" />
                </span>
                <span class="font-medium">{{ selected?.name ?? 'No principal' }}</span>
                <span
                    v-if="selected && isUser(selected)"
                    class="rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground ring-1 ring-border"
                >
                    you
                </span>
                <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
            </button>

            <div
                v-if="open"
                class="absolute left-0 top-11 z-40 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-xl"
                role="menu"
                aria-label="Choose a principal"
                data-test="scope-menu"
            >
                <p class="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Skills owned by
                </p>

                <button
                    v-for="principal in principals.principals"
                    :key="principal.id"
                    type="button"
                    :aria-current="principals.selectedPrincipalId === principal.id ? 'true' : undefined"
                    class="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted"
                    :class="principals.selectedPrincipalId === principal.id ? 'bg-muted ring-1 ring-inset ring-border' : ''"
                    :data-test="`scope-option-${principal.id}`"
                    @click="choose(principal.id)"
                >
                    <span
                        v-if="isUser(principal)"
                        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-semibold text-primary-foreground"
                    >
                        {{ initials(principal.name) }}
                    </span>
                    <span
                        v-else
                        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                    >
                        <Users class="h-3.5 w-3.5" />
                    </span>
                    <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm font-medium">{{ principal.name }}</span>
                        <span class="block text-[11px] text-muted-foreground">{{ sublabel(principal) }}</span>
                    </span>
                    <span
                        v-if="countFor(principal.id) !== null"
                        class="shrink-0 text-[11px] text-muted-foreground"
                        :data-test="`scope-count-${principal.id}`"
                    >
                        {{ countFor(principal.id) }} skills
                    </span>
                    <Check
                        v-if="principals.selectedPrincipalId === principal.id"
                        class="h-3.5 w-3.5 shrink-0"
                    />
                </button>

                <!-- Said once, before the operator spends an edit finding out:
                     membership is not ownership, and suppressing a group you cannot
                     write to would be a lie about what exists. -->
                <p class="border-t border-border bg-muted/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
                    You can read every group you belong to. Writing needs to be an
                    owner or an admin.
                </p>
            </div>
        </div>

        <!-- Two tabs, not a rail: with this few destinations a rail costs 200px to say
             the same thing, and the desk needs that width. -->
        <nav class="flex items-center gap-0.5 rounded-lg bg-muted p-0.5" aria-label="Sections">
            <RouterLink
                :to="{ path: skillsPath }"
                :aria-current="section === 'skills' ? 'page' : undefined"
                :class="section === 'skills'
                    ? 'rounded-md bg-background px-3 py-1.5 text-xs font-medium shadow-sm'
                    : 'rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground'"
                data-test="section-skills"
            >
                Skills
            </RouterLink>
            <RouterLink
                :to="{ path: cataloguePath }"
                :aria-current="section === 'library' ? 'page' : undefined"
                :class="section === 'library'
                    ? 'rounded-md bg-background px-3 py-1.5 text-xs font-medium shadow-sm'
                    : 'rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground'"
                data-test="section-catalogue"
            >
                Catalogue
            </RouterLink>
        </nav>

        <div class="ml-auto flex items-center gap-1.5">
            <RouterLink
                :to="{ path: newPath }"
                class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                data-test="new-skill"
            >
                <Plus class="h-4 w-4" />
                New skill
            </RouterLink>
        </div>
    </div>
</template>
