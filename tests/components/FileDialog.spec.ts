/**
 * The dialog that names a new or renamed file.
 *
 * The one thing worth pinning here is the folder hint. Its markup had an
 * unclosed mustache, so `join('/</span>, <span class="font-mono">')` parsed as
 * one valid JS expression — the `</span>, <span class="font-mono">` inside the
 * quotes was a string literal — and Vue escaped it, so the operator read
 * `references/</span>, <span class="font-mono">scripts/</span>…` in the dialog.
 * `vue/no-parsing-error` cannot catch that, because the expression is valid; only
 * the rendered text is wrong.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import FileDialog from '../../src/components/FileDialog.vue'

function mountDialog() {
    return mount(FileDialog, {
        props: {
            open: true,
            mode: 'create' as const,
            initialName: 'notes.md',
            initialFolder: '',
            folders: [],
            takenPaths: [],
            selfPath: undefined,
        },
    })
}

describe('the conventional folder hint', () => {
    it('renders the folder names as text, not as markup', () => {
        const text = mountDialog().get('[data-test="folder-hint"]').text()

        expect(text).toContain('references')
        expect(text).toContain('scripts')
        expect(text).toContain('assets')
        // The literal text of the bug, if the mustache is unclosed again.
        expect(text).not.toContain('<span')
        expect(text).not.toContain('</span>')
    })
})
