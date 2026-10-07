/**
 * Principal selector store: fetches `/api/v1/principals/me` once and caches it,
 * and holds the acting principal id so `useSkillsStore` resolves it at call time.
 *
 * The acting principal is *named by the URL* (`/apps/custom-skills/p/{id}/…`, see
 * `lib/hostRoute.ts`) and `App.vue` is what reconciles one from the other — so the URL
 * is the only writer, and a cold mount with no principal in the path falls back to the
 * caller's own. Persisting a selection instead would surface a different principal's
 * name and lead an operator to author under the wrong scope.
 */
import { defineStore, acceptHMRUpdate } from 'pinia'
import { ref, computed } from 'vue'
import { ApiError } from '../api/client'
import * as principalsApi from '../api/principals'
import type { Principal } from '../api/principals'

export const usePrincipalsStore = defineStore('custom-skills-principals', () => {
    const principals = ref<Principal[]>([])
    const selectedPrincipalId = ref<number | null>(null)
    const loading = ref(false)
    const error = ref<string | null>(null)

    // Shared across concurrent callers, so a page that resolves on mount and the layout
    // that loads the list are one request rather than two.
    let load: Promise<void> | null = null

    /** Resolves once the principal list is in hand, however many callers await it. */
    function ensureLoaded(): Promise<void> {
        load ??= loadPrincipals()
        return load
    }

    async function loadPrincipals(): Promise<void> {
        loading.value = true
        error.value = null
        try {
            principals.value = await principalsApi.listMyPrincipals()
            // `??=`, so a cold store adopts the default once and a later
            // `selectPrincipal()` is never undone by a refresh.
            selectedPrincipalId.value ??= defaultPrincipalId()
        } catch (e) {
            error.value = e instanceof ApiError ? e.message : 'Failed to load principals.'
        } finally {
            loading.value = false
        }
    }

    /** The caller's own user-principal, or the first entry when there is no user one. */
    function defaultPrincipalId(): number | null {
        const own = principals.value.find((p) => p.type === 'user')
        return own?.id ?? principals.value[0]?.id ?? null
    }

    /**
     * The principal the URL names, or null when the caller cannot act as it.
     *
     * `GET /principals/me` is the gate, not the API: a `p/{pid}` the caller is not a
     * member of must not be selected even to be refused later, because the panel's own
     * reads would carry an id the operator has no business sending.
     */
    function isVisible(principalId: number | null): boolean {
        return principalId !== null && principals.value.some((p) => p.id === principalId)
    }

    function selectPrincipal(id: number): void {
        selectedPrincipalId.value = id
    }

    function clearError(): void {
        error.value = null
    }

    const currentPrincipal = computed<Principal | null>(() => {
        if (selectedPrincipalId.value === null) return null
        return principals.value.find((p) => p.id === selectedPrincipalId.value) ?? null
    })

    return {
        principals,
        selectedPrincipalId,
        loading,
        error,
        loadPrincipals,
        ensureLoaded,
        defaultPrincipalId,
        isVisible,
        selectPrincipal,
        clearError,
        currentPrincipal,
    }
})

if (import.meta.hot) {
    import.meta.hot.accept(acceptHMRUpdate(usePrincipalsStore, import.meta.hot))
}
