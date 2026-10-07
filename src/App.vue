<script setup lang="ts">
/**
 * The panel's layout: the scope bar, the banners, the delete confirmation, and
 * whichever page the route resolved to.
 *
 * The bar and the dialogs live here rather than in a page because both have to
 * outlive a page: the principal is the panel's one piece of global state, and a
 * delete can be raised from a row on one page and confirmed on another.
 *
 * The `#spora-plugin-custom-skills` wrapper is the CSS scope every Tailwind
 * utility in the bundle nests beneath (see `tailwind.config.ts → important`);
 * removing it silently unscopes the plugin's CSS into the host, which is what
 * `scripts/smoke.js` fails the build for.
 *
 * The router and `hostContext` are installed in `main.ts → mount()`. A second
 * `createRouter()` here would never be `app.use()`'d, leaving `useRoute()` /
 * `useRouter()` in the descendants unbound and silently swallowing navigation.
 *
 * **This layout reconciles the acting principal with the URL**, which is where the
 * principal lives now: the path names it, the store follows, and everything below
 * reads the store. It must happen before the first skill read — the REST contract
 * resolves an absent `?principal_id=` to the caller's own principal rather than
 * refusing, so a panel that read first would call a group skill missing.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PrincipalScopeBar from './components/PrincipalScopeBar.vue'
import AlertBanner from './components/AlertBanner.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import './style.css'
import { useSkillsStore } from './stores/skills'
import { usePrincipalsStore } from './stores/principals'
import { canonicalLocalPath, principalIdInLocalPath } from './lib/hostRoute'
import { homePath } from './lib/paths'

const props = defineProps<{
    hostContext: import('./shims').PluginHostContext
}>()

defineExpose({ hostContext: props.hostContext })

const store = useSkillsStore()
const principals = usePrincipalsStore()
const router = useRouter()
const route = useRoute()

/** The principal the current path names, or null when it names none. */
const pathPrincipalId = computed(() => principalIdInLocalPath(route.path))

/**
 * Said once, when the URL names a principal the caller cannot act as.
 *
 * A shared link to a group you have since left is a real case — a path is a URL, and
 * URLs outlive membership. The alternative renders it as "No skill named … on this
 * principal", which blames the skill for a scope problem.
 *
 * Local to the layout rather than in a store: it describes one navigation, so it must
 * not survive into the next principal's session the way the skills store's notice does.
 */
const principalNotice = ref<string | null>(null)

/**
 * Put the acting principal into the URL, and the URL's principal into the store.
 *
 * Two cases, and they are not symmetric: a principal the caller can act as is selected;
 * one they cannot falls back to the default *and* has its path rewritten, so the address
 * bar stops claiming a scope the panel is not showing (nothing leaks either way — the
 * API refuses it too). A path naming no principal is canonicalised too, which is what
 * turns `/apps/custom-skills` into `/apps/custom-skills/p/{id}` once the default is known.
 */
function reconcilePrincipal(): void {
    const named = pathPrincipalId.value
    const resolved = principals.isVisible(named) ? named : principals.defaultPrincipalId()

    if (!principals.isVisible(named)) {
        principalNotice.value =
            named === null
                ? null
                : `That principal is not one of yours — showing ${principals.principals.find((p) => p.id === resolved)?.name ?? 'your own skills'} instead.`
    }

    // Only act once there *is* a principal to act as. Before `/principals/me`
    // answers there is nothing to name, and `/p/null` is a path that means nothing.
    if (resolved === null) return

    if (principals.selectedPrincipalId !== resolved) {
        principals.selectPrincipal(resolved)
    }

    const canonical = canonicalLocalPath(route.path, resolved)
    if (canonical !== route.path) {
        void router.replace(canonical).catch(() => {})
    }
}

/**
 * A confirmed delete removes the row, so whichever page raised it is now pointing
 * at something that does not exist. Home under the *current* principal is the only
 * honest landing place — and it is a no-op when the confirmation was raised from a
 * row on home already.
 */
async function confirmDelete(): Promise<void> {
    if (await store.confirmDelete() !== null) {
        await router.push(homePath(principals.selectedPrincipalId))
    }
}

/**
 * Everything that follows the acting principal: its skills and its agents. The
 * shipped catalogue is *not* re-read — it is global, and it was loaded once.
 */
async function loadForPrincipal(): Promise<void> {
    // Recorded *before* awaiting, so a scope change landing mid-flight is visible
    // as a mismatch rather than being mistaken for a covered one.
    loadingFor = principals.selectedPrincipalId
    store.setNotice(null)
    await Promise.all([store.loadSkills(), store.loadAgents()])
}

/**
 * The principal the in-flight or most recent load was *issued for*.
 *
 * A boolean "has the first load finished" flag is not enough: a host navigation can
 * select a different principal while those three round trips are still open, and the
 * flag would swallow the reload, leaving principal 8's heading above principal 7's
 * list. Comparing the selection against what was actually requested says precisely
 * whether the screen matches the scope.
 */
let loadingFor: number | null = null

/** False only while `onMounted` is still reconciling its own first selection. */
let mounted = false

onMounted(async () => {
    // The principal list first: the acting principal can only be resolved against
    // it, and the first skill read below depends on the answer.
    await principals.ensureLoaded()
    reconcilePrincipal()
    await Promise.all([store.loadPreShippedSkills(), loadForPrincipal()])
    mounted = true
    // A scope change that arrived while the reads above were open: they belong to
    // the principal selected when they were issued, so redo them.
    if (loadingFor !== principals.selectedPrincipalId) void loadForPrincipal()
})

// The scope bar navigates within the acting principal rather than writing the
// store, so this watcher is the *only* thing that reacts to a scope change — one
// writer for the principal, and one reload when it moves.
watch(
    () => principals.selectedPrincipalId,
    (next, prev) => {
        if (next === prev) return
        // A scope warning describes the scope that was rejected; once the operator
        // has moved to a different one it is stale.
        principalNotice.value = null
        // `reconcilePrincipal()` selects on mount; `onMounted` covers that reload
        // so a cold mount does not issue every request twice.
        if (!mounted || loadingFor === next) return
        void loadForPrincipal()
    },
)

// A host navigation (a palette hit, browser Back, a pasted link) can land on a
// principal the store is not on yet. The `replace` mirrors back into the host path
// via `main.ts`, so this converges rather than ping-pongs.
//
// The notice is *not* cleared here: a path change is often this very handler rewriting
// an inaccessible principal, and clearing would erase the explanation in the same tick
// it was raised. It is cleared when the operator moves to a different scope.
watch(pathPrincipalId, () => {
    reconcilePrincipal()
})
</script>

<template>
    <!-- The id is the CSS scope anchor. Its frame comes from `style.css`, not from
         utility classes: Tailwind's `important` prefix compiles to a *descendant*
         selector (`#spora-plugin-custom-skills .flex`), which cannot match the
         element carrying the id, so a class here would be dead CSS.
         `tests/buildAssets.spec.ts` pins both halves of that. -->
    <div id="spora-plugin-custom-skills">
        <PrincipalScopeBar />

        <AlertBanner v-if="store.error" type="error" :message="store.error" />
        <AlertBanner v-if="principalNotice" type="warning" :message="principalNotice" />
        <AlertBanner v-if="store.notice" type="success" :message="store.notice" />

        <div class="flex min-h-0 flex-1 flex-col">
            <RouterView />
        </div>

        <!-- Read-then-write: `requestDelete` has already fetched the allowlist and
             `deleteBlastRadius` holds the agent names this names before the write. -->
        <ConfirmDialog
            :open="store.pendingDelete !== null"
            :busy="store.saving"
            title="Delete this skill?"
            :body="store.pendingDelete
                ? `“${store.pendingDelete}” is removed from this principal, together with its sidecar files.`
                : ''"
            :affected-agents="store.deleteBlastRadius"
            @confirm="confirmDelete"
            @cancel="store.cancelDelete"
        />
    </div>
</template>
