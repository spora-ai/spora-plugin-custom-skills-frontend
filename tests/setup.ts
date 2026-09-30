/**
 * Vitest global setup — mocks for browser APIs not available in
 * happy-dom and heavy third-party components that touch the DOM in
 * ways the test runner can't easily support.
 *
 * - `md-editor-v3` mounts CodeMirror 6 + highlight.js + katex +
 *   mermaid. Happy-dom doesn't provide the layout primitives those
 *   need and the library would try to fetch external CSS from
 *   unpkg.com. We replace `<MdEditor>` and `<MdPreview>` with
 *   lightweight stubs that support `v-model` and emit
 *   `update:modelValue` so consumers can still exercise their
 *   handlers without a real editor instance.
 *
 * - `lucide-vue-next` and `dompurify` are real here (unlike in the
 *   built bundle, where they are host-provided externals). Keeping
 *   the real DOMPurify is deliberate: `SkillEditor` passes
 *   `DOMPurify.sanitize` straight into the editor's `sanitize` prop,
 *   and stubbing it would make the preview assertions meaningless.
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
        // Mirror the props the production template actually binds so
        // vue-tsc doesn't reject them at runtime. The stub surfaces
        // `preview` and the sanitiser output as data attributes so
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
                    'data-md-sanitized': rendered,
                    id: (props.id as string | undefined) ?? undefined,
                    value,
                    disabled: Boolean(props.disabled),
                    placeholder: (props.placeholder as string | undefined) ?? '',
                    rows: Number(props.rows ?? 6),
                    onInput: (e: Event) => {
                        emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
                    },
                })
            }
        },
    })

    const MdPreview = defineComponent({
        name: 'MdPreview',
        props: ['modelValue', 'theme', 'language'],
        setup(props) {
            return () => h('div', {
                'data-testid': 'md-preview-stub',
                'data-md-preview': 'true',
            }, (props.modelValue as string | null | undefined) ?? '')
        },
    })

    return { MdEditor, MdPreview }
})
