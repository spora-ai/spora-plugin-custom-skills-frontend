/**
 * Pinia store for the principal selector.
 *
 * Fetches `/api/v1/principals/me` once on mount and caches the
 * result so the chip row doesn't re-fetch every tab switch.
 * Selected principal id is kept here so it survives pane interaction
 * without prop-drilling, and so `useSkillsStore` can resolve the
 * acting principal at call time.
 *
 * **No persistence** — `selectedPrincipalId` is deliberately
 * session-scoped. Persisting across browser sessions could surface a
 * different principal's name and lead an operator to believe they are
 * authoring skills under the wrong scope. Re-selecting on every mount
 * is cheap and self-correcting.
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

    async function loadPrincipals(): Promise<void> {
        loading.value = true
        error.value = null
        try {
            principals.value = await principalsApi.listMyPrincipals()
            if (selectedPrincipalId.value === null) {
                const ownPrincipal = principals.value.find((p) => p.type === 'user')
                selectedPrincipalId.value = ownPrincipal?.id ?? principals.value[0]?.id ?? null
            }
        } catch (e) {
            error.value = e instanceof ApiError ? e.message : 'Failed to load principals.'
        } finally {
            loading.value = false
        }
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
        selectPrincipal,
        clearError,
        currentPrincipal,
    }
})

if (import.meta.hot) {
    import.meta.hot.accept(acceptHMRUpdate(usePrincipalsStore, import.meta.hot))
}
