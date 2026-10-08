<script setup lang="ts">
/**
 * The panel's layout: scope bar, banners, delete confirmation, resolved page. The bar and dialogs
 * live here because both must outlive a page — the principal is the panel's one piece of global state,
 * and a delete can be raised on one page and confirmed on another.
 *
 * `#spora-plugin-custom-skills` is the CSS scope every Tailwind utility nests beneath
 * (`tailwind.config.ts → important`); removing it unscopes the plugin's CSS into the host.
 *
 * The URL and the acting principal are reconciled here, before the first skill read: an absent
 * `?principal_id=` resolves to the caller's own, so a panel that read first calls a group skill missing.
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

const pathPrincipalId = computed(() => principalIdInLocalPath(route.path))

/** Said once, when the URL names a principal the caller cannot act as — a shared link to a group you
 *  have since left. The alternative blames the skill for a scope problem. */
const principalNotice = ref<string | null>(null)

/**
 * Put the acting principal into the URL, and the URL's principal into the store. An inaccessible one
 * falls back to the default *and* has its path rewritten, so the address bar stops claiming a scope
 * the panel is not showing; a principal-less path is canonicalised too.
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

    // Only act once there *is* one — `/p/null` means nothing.
    if (resolved === null) return

    if (principals.selectedPrincipalId !== resolved) {
        principals.selectPrincipal(resolved)
    }

    const canonical = canonicalLocalPath(route.path, resolved)
    if (canonical !== route.path) {
        void router.replace(canonical).catch(() => {})
    }
}

/** A confirmed delete removes the row, so home under the *current* principal is the honest landing. */
async function confirmDelete(): Promise<void> {
    if (await store.confirmDelete() !== null) {
        await router.push(homePath(principals.selectedPrincipalId))
    }
}

/** Its skills and agents. The global catalogue is not re-read. */
async function loadForPrincipal(): Promise<void> {
    // Recorded *before* awaiting, so a mid-flight scope change shows as a mismatch.
    loadingFor = principals.selectedPrincipalId
    store.setNotice(null)
    await Promise.all([store.loadSkills(), store.loadAgents()])
}

/** The principal the in-flight or most recent load was *issued for*. A boolean "first load finished"
 *  flag is not enough: a host navigation can select another principal while those round trips are
 *  open, and the flag would swallow the reload. */
let loadingFor: number | null = null

/** False only while `onMounted` is still reconciling its own first selection. */
let mounted = false

onMounted(async () => {
    // The principal list first: nothing below can resolve an acting principal until it answers.
    await principals.ensureLoaded()
    reconcilePrincipal()
    await Promise.all([store.loadPreShippedSkills(), loadForPrincipal()])
    mounted = true
    // A scope change that arrived while those reads were open: they belong to the principal selected
    // when issued, so redo them.
    if (loadingFor !== principals.selectedPrincipalId) void loadForPrincipal()
})

// The scope bar navigates rather than writing the store, so this is the only writer of it.
watch(
    () => principals.selectedPrincipalId,
    (next, prev) => {
        if (next === prev) return
        // A scope warning describes the scope that was rejected; on another scope it is stale.
        principalNotice.value = null
        // `onMounted` covers the reload `reconcilePrincipal()` triggers there.
        if (!mounted || loadingFor === next) return
        void loadForPrincipal()
    },
)

// A host navigation can land on a principal the store is not on yet; the `replace` mirrors back
// into the host path via `main.ts`, so this converges rather than ping-pongs. The notice is *not*
// cleared — a path change is often this very handler raising it.
watch(pathPrincipalId, () => {
    reconcilePrincipal()
})
</script>

<template>
    <!-- The id is the CSS scope anchor. Its frame comes from `style.css`, not from utility classes:
         Tailwind's `important` prefix compiles to a *descendant* selector, which cannot match
         the element carrying the id. Pinned by `tests/buildAssets.spec.ts`. -->
    <div id="spora-plugin-custom-skills">
        <PrincipalScopeBar />

        <AlertBanner v-if="store.error" type="error" :message="store.error" />
        <AlertBanner v-if="principalNotice" type="warning" :message="principalNotice" />
        <AlertBanner v-if="store.notice" type="success" :message="store.notice" />

        <div class="flex min-h-0 flex-1 flex-col">
            <RouterView />
        </div>

        <!-- Read-then-write: `requestDelete` has already fetched the allowlist. -->
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
