<script setup lang="ts">
/**
 * The `allowed-tools` checkbox group.
 *
 * Extracted from `SkillDesk.vue` because it is the tallest thing in the
 * frontmatter — one row per installed tool, so a real instance renders dozens —
 * and it was carrying the desk's file size with it. It has one job, one buffer
 * and one source of options, none of which the desk needs.
 *
 * **The buffer is the stored string, verbatim, not a parsed list.** An untouched
 * value round-trips byte for byte, including the parts of a malformed value the
 * author has not fixed yet; core's `SkillValidator` judges it and this shows it.
 * An *edited* value is re-serialised, so it collapses whitespace runs and drops
 * duplicates — the plugin is storage, core is the judge.
 *
 * **The options are the registry unioned with the stored names.** A name no
 * installed tool answers to stays on screen as a disabled row rather than
 * vanishing: dropping it would make the declaration invisible *and* delete it on
 * the next unrelated save, which is exactly what core's
 * `ALLOWED_TOOLS_UNKNOWN_TOOL` warning exists to stop from being an error.
 *
 * A checkbox group, not a text input and not a `<select multiple>`: the grammar
 * is a space-separated list of bare tool names, so a free-text box invites the
 * three forms core rejects — commas, FQCNs, `Bash(git:*)` — and offers nothing
 * for the common case of ticking a tool you can see. There is no multi-select
 * component reachable from a plugin (the host's UI library is not importable
 * here, the same reason `AlertBanner.vue` is a verbatim copy), so this follows
 * the *markup* of the host's `ToolSettingField.vue`: one plain checkbox per
 * option, description under the label, and the `<template v-else>` wrapper
 * because `v-else` and `v-for` on one element is a precedence trap.
 */
import { computed, useId } from 'vue'
import { declaredToolNames, serializeToolNames, toolOptions } from '../lib/skillFormat'
import type { SkillValidationEntry, ToolSummary } from '../types'

const props = withDefaults(
    defineProps<{
        /** The stored `allowed-tools` string, unparsed. */
        modelValue: string
        /**
         * The instance's registry, or `null` when it was never read.
         *
         * `null` is deliberately distinct from `[]`: an instance with no tools makes
         * a claim about a declared name, and a registry that failed to load does not.
         */
        tools?: ToolSummary[] | null
        readOnly?: boolean
        errors?: SkillValidationEntry[]
    }>(),
    {
        tools: null,
        readOnly: false,
        errors: () => [],
    },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

/**
 * Scoped rather than a literal `allowed-tools-errors`, so two desks on one page
 * cannot end up pointing their `aria-describedby` at the same list.
 */
const errorListId = `${useId()}-errors`

const rows = computed(() => toolOptions(props.tools, props.modelValue))

/**
 * Add or remove one name, leaving every other declared name in place.
 */
function toggle(name: string, checked: boolean): void {
    const current = declaredToolNames(props.modelValue)
    emit(
        'update:modelValue',
        checked
            ? serializeToolNames([...current, name])
            : serializeToolNames(current.filter((entry) => entry !== name)),
    )
}

/**
 * Whether the wire name says anything the display name does not.
 *
 * The row used to carry three lines — display name, wire name, description —
 * and the second was usually noise: `Time` over `time`, `Read URL` over
 * `read_url`. The wire name is what lands in `allowed-tools`, so it has to stay
 * legible, but only when it is not simply the label in another typeface.
 * Spaces and hyphens normalise to underscores for the comparison, because that
 * is how a human label is derived from a snake_case name in the first place.
 *
 * The full name stays in the row's `title` either way, so nothing is lost to a
 * truncated description.
 */
function nameIsRedundant(label: string, name: string): boolean {
    return label.trim().toLowerCase().replace(/[\s-]+/g, '_') === name.toLowerCase()
}
</script>

<template>
    <fieldset
        class="min-w-0 border-0 p-0"
        :aria-describedby="errors.length > 0 ? errorListId : undefined"
        data-test="field-allowed-tools"
    >
        <!-- "Tools this skill uses", not "Required tools" and not "Pre-approved
             tools": the spec's wording for this field is "pre-approved tools", and
             Spora implements no pre-approval and enforces nothing. A label promising
             either would be a promise the system does not keep. -->
        <legend class="mb-1.5 block text-xs font-medium">
            Tools this skill uses
        </legend>

        <!-- Only a registry that was actually read may claim the instance has no
             tools: `tools === null` means the read failed, and `[]` in place of it
             would make every declaration look unresolvable. -->
        <div
            v-if="rows.length === 0 && tools !== null"
            class="text-[11px] text-muted-foreground"
            data-test="allowed-tools-empty"
        >
            No tools are registered on this instance.
        </div>
        <div
            v-else-if="rows.length === 0"
            class="text-[11px] text-muted-foreground"
            data-test="allowed-tools-unavailable"
        >
            The tool registry could not be read. Declared tools are shown as stored.
        </div>
        <template v-else>
            <!-- A real instance has dozens of tools, so the list scrolls inside its
                 own box rather than pushing the editor — the thing most visits are
                 for — off the bottom of the window. -->
            <div class="scroll-quiet max-h-56 overflow-y-auto pr-1" data-test="allowed-tools-list">
                <!--
                One line per tool.

                Three lines — display name, wire name, description — is the shape the
                host's own `ToolSettingField.vue` multi-select uses, and it is the
                wrong shape here: a real instance renders dozens of rows, so three
                lines each is a list taller than the editor it sits above, inside a
                group that already had to be collapsed and then scrolled.

                So the description goes inline and truncates, the wire name appears
                only when the display name does not already spell it (see
                `nameIsRedundant`), and the unresolvable note becomes a trailing pill
                rather than a fourth line. Everything dropped from view is still on
                the row's `title`.

                The description truncates rather than disappearing because it is what
                separates two similarly-named tools, and ticking the wrong one is the
                failure this list exists to prevent.
                -->
                <label
                    v-for="row in rows"
                    :key="row.name"
                    class="flex items-center gap-2 py-px text-xs"
                    :class="row.available ? '' : 'text-muted-foreground'"
                    :title="`${row.name} — ${row.description || row.label}`"
                    :data-test="`tool-option-${row.name}`"
                >
                    <input
                        type="checkbox"
                        class="shrink-0"
                        :value="row.name"
                        :checked="row.selected"
                        :disabled="!row.available || readOnly"
                        :aria-invalid="errors.length > 0"
                        @change="toggle(row.name, ($event.target as HTMLInputElement).checked)"
                    >
                    <span class="shrink-0 font-medium">{{ row.label }}</span>
                    <span
                        v-if="!nameIsRedundant(row.label, row.name)"
                        class="shrink-0 font-mono text-[10px] text-muted-foreground"
                        :data-test="`tool-name-${row.name}`"
                    >{{ row.name }}</span>
                    <span
                        v-if="row.description"
                        class="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
                        :data-test="`tool-description-${row.name}`"
                    >{{ row.description }}</span>
                    <!--
                    A name no installed tool answers to. Not a claim about
                    enforcement — nothing is enforced — only that this instance
                    cannot resolve it. "Kept as declared" moved to the title: the
                    row is one line now, and truncating the reassuring half off the
                    pill would be worse than the pill.
                    -->
                    <span
                        v-if="!row.available"
                        class="ml-auto shrink-0 rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-300"
                        title="Kept as declared — this instance cannot resolve it, but the next save will not drop it."
                        data-test="tool-unavailable-note"
                    >Not available on this instance</span>
                </label>
            </div>
        </template>

        <p class="mt-1 text-[11px] text-muted-foreground">
            A hint for whoever reads this skill. Spora grants no pre-approval from it and
            enforces nothing — an agent can still call a tool that is not on this list.
        </p>

        <ul
            v-for="entry in errors"
            :id="errorListId"
            :key="entry.code + entry.message"
            class="mt-1 text-xs text-destructive"
            data-test="field-error"
        >
            {{ entry.message }}
        </ul>
    </fieldset>
</template>