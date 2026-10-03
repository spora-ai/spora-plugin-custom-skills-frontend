<script setup lang="ts">
/**
 * The order control for a list of skills. Present on every list in the panel —
 * home and catalogue alike — because "which of these do I want" and "which order
 * do I want them in" are the same question once the list is longer than about
 * five rows, and a sort that only exists on one of them teaches that it probably
 * does not matter.
 *
 * `options` rather than a fixed set: the catalogue summaries carry no timestamps,
 * so offering "recently updated" there would be a sort that silently returns the
 * wrong order.
 */
import { ChevronDown } from 'lucide-vue-next'

defineProps<{
    id: string
    options: ReadonlyArray<{ value: string; label: string }>
    modelValue: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

function onChange(event: Event): void {
    emit('update:modelValue', (event.target as HTMLSelectElement).value)
}
</script>

<template>
    <div class="flex items-center gap-2">
        <label :for="id" class="text-xs text-muted-foreground">Sort</label>
        <div class="relative">
            <select
                :id="id"
                :value="modelValue"
                class="h-8 appearance-none rounded-lg border border-border bg-background pl-3 pr-8 text-xs font-medium transition-colors hover:bg-muted/50"
                @change="onChange"
            >
                <option v-for="option in options" :key="option.value" :value="option.value">
                    {{ option.label }}
                </option>
            </select>
            <ChevronDown
                class="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            />
        </div>
    </div>
</template>
