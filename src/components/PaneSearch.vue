<script setup lang="ts">
import { computed, useId } from 'vue'
import { Search, X } from 'lucide-vue-next'

/**
 * Per-pane search box.
 *
 * Each pane owns its own term — filtering the pre-shipped catalogue
 * with the term typed into "My skills" is the kind of cross-pane
 * coupling that makes a list feel haunted. The `v-model` contract is
 * two-way so the page can hold the term for its empty-state copy
 * ("No skill matches "foo".") without reaching into the child.
 *
 * Purely client-side: the filter runs over the array the pane already
 * holds. Neither REST contract has a `?q=`, and round-tripping per
 * keystroke would be both slower and a worse experience.
 */
const props = withDefaults(
    defineProps<{
        modelValue: string
        placeholder?: string
        label: string
        resultCount?: number
    }>(),
    { placeholder: 'Search…', resultCount: undefined },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const inputId = `${useId()}-pane-search`

const hasValue = computed(() => props.modelValue.trim() !== '')

function onInput(event: Event): void {
    emit('update:modelValue', (event.target as HTMLInputElement).value)
}

function clear(): void {
    emit('update:modelValue', '')
}
</script>

<template>
    <div class="relative">
        <label :for="inputId" class="sr-only">{{ label }}</label>
        <Search class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
            :id="inputId"
            :value="modelValue"
            type="search"
            :placeholder="placeholder"
            :data-test="`pane-search-${label.toLowerCase().replace(/\s+/g, '-')}`"
            class="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-8 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
            @input="onInput"
        />
        <button
            v-if="hasValue"
            type="button"
            class="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            :aria-label="`Clear ${label} filter`"
            data-test="pane-search-clear"
            @click="clear"
        >
            <X class="h-3.5 w-3.5" />
        </button>
    </div>
</template>
