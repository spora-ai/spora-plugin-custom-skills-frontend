<script setup lang="ts">
/**
 * Principal chip row — the scope control above both panes.
 *
 * Renders one chip per principal the caller can see (their own
 * user-principal + every group-principal they're a member of). No
 * "ALL" / combined chip: a skill belongs to exactly one principal, so
 * a union view would be a lie. Selecting a chip re-scopes both panes;
 * the read is honest, the writes are not — a group the caller is a
 * plain member of answers 403 on write, and the store surfaces that
 * message rather than hiding the group.
 *
 * Loading state: skeletons until the principals store resolves
 * `/principals/me`. Error state: a single inline message.
 */
import { onMounted } from 'vue'
import { usePrincipalsStore } from '../stores/principals'

const principals = usePrincipalsStore()

onMounted(() => {
    if (principals.principals.length === 0) {
        principals.loadPrincipals()
    }
})

function chipClass(id: number): string {
    const active = principals.selectedPrincipalId === id
    return [
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
        active
            ? 'bg-primary text-primary-foreground border-primary shadow-sm'
            : 'bg-background text-foreground border-border hover:bg-primary hover:text-primary',
    ].join(' ')
}

/**
 * The own-principal chip is labelled "My skills" rather than
 * "User #7": the host names user-principals numerically and that
 * string is meaningless in a skills panel.
 */
function chipLabel(p: { name: string; type: string }): string {
    return p.type === 'user' ? 'My skills' : p.name
}
</script>

<template>
    <div class="flex items-center gap-2 flex-wrap" role="tablist" aria-label="Principal scope">
        <span class="text-xs text-muted-foreground uppercase tracking-wide">Scope</span>
        <div v-if="principals.loading && principals.principals.length === 0" class="flex items-center gap-2">
            <span
                v-for="i in 3"
                :key="i"
                class="inline-block h-7 w-24 rounded-full bg-muted animate-pulse"
                aria-hidden="true"
            />
        </div>
        <button
            v-for="p in principals.principals"
            :key="p.id"
            type="button"
            role="tab"
            :aria-selected="principals.selectedPrincipalId === p.id"
            :class="chipClass(p.id)"
            :data-test="`principal-chip-${p.id}`"
            @click="principals.selectPrincipal(p.id)"
        >
            {{ chipLabel(p) }}
        </button>
        <div
            v-if="principals.error"
            class="text-sm text-destructive"
            role="alert"
        >
            {{ principals.error }}
        </div>
    </div>
</template>
