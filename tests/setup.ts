/**
 * Vitest global setup — browser APIs happy-dom lacks, and third-party components
 * the runner can't support.
 *
 * - `md-editor-v3` mounts CodeMirror 6 + highlight.js / katex / mermaid, none of
 *   which work under happy-dom (it would fetch CSS from unpkg.com). `<MdEditor>`
 *   and `<MdPreview>` become lightweight stubs that support `v-model` and emit
 *   `update:modelValue`, so consumers still exercise their handlers. The
 *   `<MdEditor>` stub mirrors the props the desk binds, and surfaces `readOnly`
 *   and `toolbars` as data attributes so a test can assert the read-only
 *   contract without mounting CodeMirror.
 *
 * - `lucide-vue-next` and `dompurify` are real here (the bundle also
 *   bundles them — the host publishes neither). Keeping the real
 *   DOMPurify is deliberate: `SkillEditor` passes `DOMPurify.sanitize`
 *   straight into the editor's `sanitize` prop, and stubbing it would
 *   make the preview assertions meaningless.
 */
/* eslint-disable vue/one-component-per-file, vue/require-prop-types --
   These are Vitest stubs for an external library; they intentionally
   declare props as a string array to mirror the production surface
   without pulling in the real `md-editor-v3` types (which would drag
   in CodeMirror 6 type defs the test runner can't satisfy). */

import { vi } from 'vitest'

vi.mock('md-editor-v3', async () => {
    const { defineComponent, h } = await import('vue')

    const MdEditor = defineComponent({
        name: 'MdEditor',
        // Mirror the props the production template binds so vue-tsc doesn't reject
        // them. `preview` and the sanitiser output surface as data attributes, so
        // tests can assert the editor's sanitisation contract.
        props: [
            'modelValue',
            'theme',
            'preview',
            'sanitize',
            'placeholder',
            'rows',
            'maxLength',
            'disabled',
            'readOnly',
            'language',
            'toolbars',
            'showToolbarName',
            'id',
        ],
        emits: ['update:modelValue'],
        setup(props, { emit }) {
            return () => {
                const value = (props.modelValue as string | null | undefined) ?? ''
                const sanitize = props.sanitize as ((html: string) => string) | undefined
                const rendered = typeof sanitize === 'function'
                    ? sanitize(`<p>${value}</p>`)
                    : `<p>${value}</p>`
                return h('textarea', {
                    'data-testid': 'md-editor-stub',
                    'data-md-editor': 'true',
                    'data-md-preview-on': String(Boolean(props.preview)),
                    'data-md-readonly': String(Boolean(props.readOnly)),
                    'data-md-toolbars': JSON.stringify(props.toolbars ?? []),
                    'data-md-sanitized': rendered,
                    id: (props.id as string | undefined) ?? undefined,
                    value,
                    disabled: Boolean(props.disabled),
                    readOnly: Boolean(props.readOnly),
                    placeholder: (props.placeholder as string | undefined) ?? '',
                    rows: Number(props.rows ?? 6),
                    onInput: (e: Event) => {
                        if (props.readOnly) return
                        emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
                    },
                })
            }
        },
    })

    const MdPreview = defineComponent({
        name: 'MdPreview',
        props: ['modelValue', 'theme', 'language'],
        setup(props, { attrs }) {
            return () => h('div', {
                'data-testid': 'md-preview-stub',
                'data-md-preview': 'true',
                // The production template sets a class for the hand-written preview
                // typography, and the stub has to keep it for a test to be able to
                // assert the class is on the rendered node.
                class: attrs['class'] as string | undefined,
            }, (props.modelValue as string | null | undefined) ?? '')
        },
    })

    return { MdEditor, MdPreview }
})
