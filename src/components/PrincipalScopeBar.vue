<script setup lang="ts">
/**
 * The panel's one piece of global state, made visible: which principal's skills
 * everything below belongs to, and where the panel's pages are.
 *
 * A dropdown, not a chip row: a row of equal-weight chips reads as *filters*, and
 * a filter chip does not say "everything below this belongs to what I picked". The
 * per-entry skill count is what makes it a scope — you can see the shape of each
 * scope before committing to it.
 *
 * **No search box, deliberately.** A ⌘K palette already exists one layer up and
 * covers agents, groups and chats. A second search box inside a plugin panel is
 * not a shortcut to the same thing — it is two search boxes that disagree, and
 * this one would be strictly narrower, since the store only ever holds the
 * *selected* principal's skills. Until core accepts search contributions from
 * plugins, this panel stays sorted-and-scrolled.
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check, ChevronDown, Plus, Users } from 'lucide-vue-next'
import { useSkillsStore } from '../stores/skills'
import { usePrincipalsStore } from '../stores/principals'
import type { Principal } from '../api/principals'

const principals = usePrincipalsStore()
const store = useSkillsStore()
const route = useRoute()
const router = useRouter()

const open = ref(false)

const selected = computed<Principal | null>(() => principals.currentPrincipal)

/**
 * "Skills" is the section for everything that is not the catalogue, including the
 * desk and the create form — the tab says which side of the panel you are on, not
 * which page.
 */
const section = computed(() => (route.path.startsWith('/library') ? 'library' : 'skills'))

/**
 * A type glyph rather than an avatar: the host has no portrait for a principal,
 * and an initial-in-a-circle invites the reader to treat a group as a person.
 */
function initials(name: string): string {
    return name
        .split(/\s+/)
        .filter((part) => /[a-z0-9]/i.test(part))
        .slice(0, 2)
        // `[...part][0]`, not `charAt(0)`: a word can pass the filter above on an
        // ASCII letter while *starting* with an astral character ("🚀 Team"), and
        // `charAt` indexes UTF-16 code units, so it would return a lone surrogate
        // and the badge would render a replacement glyph instead of the T.
        .map((part) => [...part][0]!.toUpperCase())
        .join('')
}

function isUser(principal: Principal): boolean {
    return principal.type === 'user'
}

/**
 * `GET /api/v1/principals/me` carries no membership role, so a group entry cannot
 * say "owner", "admin" or "member" — the read/write split is stated once, for
 * every group, in the footer of the list instead of being guessed at per entry.
 */
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
 * A scope change lands on home. The desk's URL says `invoice-drafting` and
 * nothing about whose it is, so re-pointing it at another principal's
 * identically-named skill while the operator is mid-edit is the worst outcome the
 * routing enables — and home is the one page where the principal is the subject.
 */
async function choose(id: number): Promise<void> {
    open.value = false
    if (principals.selectedPrincipalId !== id) {
        principals.selectPrincipal(id)
    }
    await router.push({ path: '/' })
}

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

                <!--
                    Said once, before the operator spends an edit finding out:
                    membership is not ownership. Suppressing a group you cannot write
                    to would be cleaner UX and a lie about what exists.
                -->
                <p class="border-t border-border bg-muted/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
                    You can read every group you belong to. Writing needs to be an
                    owner or an admin.
                </p>
            </div>
        </div>

        <!-- Two tabs, not a rail: with this few destinations a rail costs 200px of
             width to say the same thing, and the desk needs that width. -->
        <nav class="flex items-center gap-0.5 rounded-lg bg-muted p-0.5" aria-label="Sections">
            <RouterLink
                :to="{ path: '/' }"
                :aria-current="section === 'skills' ? 'page' : undefined"
                :class="section === 'skills'
                    ? 'rounded-md bg-background px-3 py-1.5 text-xs font-medium shadow-sm'
                    : 'rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground'"
                data-test="section-skills"
            >
                Skills
            </RouterLink>
            <RouterLink
                :to="{ path: '/library' }"
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
                :to="{ path: '/new' }"
                class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                data-test="new-skill"
            >
                <Plus class="h-4 w-4" />
                New skill
            </RouterLink>
        </div>
    </div>
</template>
