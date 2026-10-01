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
 */
import { onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import PrincipalScopeBar from './components/PrincipalScopeBar.vue'
import AlertBanner from './components/AlertBanner.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import './style.css'
import { useSkillsStore } from './stores/skills'
import { usePrincipalsStore } from './stores/principals'

const props = defineProps<{
    hostContext: import('./shims').PluginHostContext
}>()

defineExpose({ hostContext: props.hostContext })

const store = useSkillsStore()
const principals = usePrincipalsStore()
const router = useRouter()

/**
 * A confirmed delete removes the row, so whichever page raised it is now pointing
 * at something that does not exist. Home is the only honest landing place, and it
 * is a no-op when the confirmation was raised from a row on home already.
 */
async function confirmDelete(): Promise<void> {
    if (await store.confirmDelete() !== null) {
        await router.push({ path: '/' })
    }
}

onMounted(async () => {
    if (principals.principals.length === 0) {
        await principals.loadPrincipals()
    }
    await Promise.all([
        store.loadSkills(),
        store.loadPreShippedSkills(),
        store.loadAgents(),
    ])
})

// The scope bar navigates to home on a change, so the reload is the only thing
// that has to react: the list, the counts and the agents all follow the principal.
watch(
    () => principals.selectedPrincipalId,
    (next, prev) => {
        if (next === prev) return
        store.setNotice(null)
        void Promise.all([store.loadSkills(), store.loadAgents()])
    },
)
</script>

<template>
    <div id="spora-plugin-custom-skills" class="flex min-h-screen flex-col bg-background">
        <PrincipalScopeBar />

        <AlertBanner v-if="store.error" type="error" :message="store.error" />
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
