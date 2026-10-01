<script setup lang="ts">
/**
 * The source editor for a file that is not markdown.
 *
 * CodeMirror 6, not `md-editor-v3`: this is a code editor, and md-editor-v3 is a
 * markdown editor. Handing `data.json` to it offered a bold and task-list toolbar
 * and rendered the file as prose in the preview. The plain `<textarea>` that
 * replaced it was correct but featureless.
 *
 * CodeMirror is already in the bundle — `md-editor-v3` depends on it, so the
 * packages are installed and Rollup resolves them to the same instances rather
 * than bundling a second copy. It is declared in `package.json` anyway: reaching
 * a transitive dependency is not something npm guarantees, and a version bump
 * under md-editor-v3 that hoisted differently would break the build rather than
 * resolve to a different version.
 *
 * `basicSetup` is what makes this worth having over a textarea: line numbers,
 * bracket matching, search across the file, undo history, indent units and
 * autocompletion. Language modes come from `src/lib/editorLanguages.ts` — a
 * bounded static set, because the catalogue cannot be code-split out of an IIFE
 * bundle and costs 1.7 MB when it is not.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { basicSetup, EditorView } from 'codemirror'
import { Compartment } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { languageFor } from '../lib/editorLanguages'

const props = withDefaults(
    defineProps<{
        modelValue: string
        /** The file's path, which is how the language mode is chosen. */
        path: string
        readOnly?: boolean
    }>(),
    { readOnly: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const host = ref<HTMLElement | null>(null)
let view: EditorView | null = null

/**
 * A theme in the host's tokens, so the editor chrome is not the one bright
 * block in a dark panel. `basicSetup` brings none, and the default is light-only.
 */
const theme = EditorView.theme({
    '&': { color: 'hsl(var(--foreground))', backgroundColor: 'hsl(var(--background))', height: '100%' },
    '.cm-content': { caretColor: 'hsl(var(--foreground))', fontFamily: 'ui-monospace, monospace' },
    '.cm-gutters': {
        backgroundColor: 'hsl(var(--muted) / 0.3)',
        color: 'hsl(var(--muted-foreground))',
        border: 'none',
    },
    '.cm-activeLine': { backgroundColor: 'hsl(var(--muted) / 0.35)' },
    '.cm-activeLineGutter': { backgroundColor: 'hsl(var(--muted) / 0.5)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: 'hsl(var(--primary) / 0.25)',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'hsl(var(--foreground))' },
})

/**
 * Comment and string colours, from the host's tokens.
 *
 * A `HighlightStyle` of its own rather than `defaultHighlightStyle`, which is
 * tuned for a light background and washes out against one.
 */
const highlight = syntaxHighlighting(
    HighlightStyle.define([
        { tag: tags.comment, color: 'hsl(var(--muted-foreground))', fontStyle: 'italic' },
        { tag: [tags.string, tags.special(tags.string)], color: 'oklch(0.55 0.13 145)' },
        { tag: [tags.number, tags.bool, tags.null], color: 'oklch(0.55 0.14 250)' },
        { tag: [tags.keyword, tags.modifier], color: 'oklch(0.5 0.16 300)' },
        { tag: [tags.function(tags.variableName), tags.labelName], color: 'oklch(0.5 0.12 200)' },
        { tag: [tags.typeName, tags.className], color: 'oklch(0.55 0.1 60)' },
        { tag: tags.propertyName, color: 'oklch(0.5 0.1 200)' },
        { tag: tags.invalid, color: 'hsl(var(--destructive))' },
    ]),
)

/**
 * The mode lives in a compartment so switching files can replace it.
 *
 * A compartment rather than a second editor, because rebuilding the view would
 * throw away the undo history and the scroll position. Reconfiguring to `[]` is
 * how a mode is *removed* — a `Makefile` with no mode must not keep the previous
 * file's highlighting.
 */
const languageCompartment = new Compartment()

/** `editable` is a facet, so switching it needs a compartment like the mode. */
const editableCompartment = new Compartment()

function applyLanguage(path: string): void {
    // Synchronous, and that is the point: the modes are static imports, so there
    // is no await to outrun and no way for a file switch to land a stale mode on
    // the wrong file.
    view?.dispatch({
        effects: languageCompartment.reconfigure(languageFor(path) ?? []),
    })
}

onMounted(async () => {
    if (host.value === null) return

    view = new EditorView({
        parent: host.value,
        doc: props.modelValue,
        extensions: [
            basicSetup,
            theme,
            highlight,
            EditorView.lineWrapping,
            languageCompartment.of([]),
            editableCompartment.of(EditorView.editable.of(!props.readOnly)),
            EditorView.updateListener.of((update) => {
                if (!update.docChanged) return
                emit('update:modelValue', update.state.doc.toString())
            }),
        ],
    })

    applyLanguage(props.path)
})

onBeforeUnmount(() => {
    view?.destroy()
    view = null
})

// Switching files replaces the document in place rather than rebuilding the
// view, so undo history and the scroll position of the surrounding pane survive.
watch(
    () => props.modelValue,
    (value) => {
        if (view === null) return
        const current = view.state.doc.toString()
        if (current === value) return
        view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    },
)

watch(() => props.readOnly, (readOnly) => {
    view?.dispatch({
        effects: editableCompartment.reconfigure(EditorView.editable.of(!readOnly)),
    })
})

watch(() => props.path, (path) => {
    applyLanguage(path)
})
</script>

<template>
    <div
        ref="host"
        class="h-full min-h-[18rem] overflow-hidden"
        :data-language="path.includes('.') ? path.split('.').pop() : ''"
        :data-readonly="readOnly"
        data-test="source-editor"
    />
</template>
