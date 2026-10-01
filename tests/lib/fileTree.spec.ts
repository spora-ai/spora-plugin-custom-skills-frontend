/**
 * The rail's tree derivation and the markdown/plain-text decision.
 *
 * Both exist because the contract's `files` is a flat `path => content` map: a
 * folder is something a path implies rather than something stored, and a
 * sidecar's format is decided by its extension rather than by a rule somewhere.
 */
import { describe, it, expect } from 'vitest'
import { fileTree, flattenTree, folderPaths, isMarkdownPath } from '../../src/lib/skillFormat'

describe('isMarkdownPath', () => {
    it('treats only .md as markdown, case-insensitively', () => {
        expect(isMarkdownPath('SKILL.md')).toBe(true)
        expect(isMarkdownPath('references/API.MD')).toBe(true)
        expect(isMarkdownPath('data.json')).toBe(false)
        expect(isMarkdownPath('scripts/build.py')).toBe(false)
        expect(isMarkdownPath('Makefile')).toBe(false)
        expect(isMarkdownPath('notes.md.txt')).toBe(false)
    })
})

describe('fileTree', () => {
    it('nests by path segment', () => {
        const tree = fileTree(['examples/invoice.md', 'examples/cover.md', 'notes.md'])

        expect(tree.map((n) => n.name)).toEqual(['examples', 'notes.md'])
        expect(tree[0]?.children.map((n) => n.name)).toEqual(['cover.md', 'invoice.md'])
        expect(tree[0]?.path).toBe('examples')
    })

    it('nests deeper than one level', () => {
        const tree = fileTree(['a/b/c/deep.md'])
        expect(folderPaths(tree)).toEqual(['a', 'a/b', 'a/b/c'])
        expect(tree[0]?.children[0]?.children[0]?.children[0]?.path).toBe('a/b/c/deep.md')
    })

    it('sorts folders before files at every level', () => {
        const tree = fileTree(['zeta.md', 'alpha/one.md', 'beta.md', 'alpha/two.md'])
        expect(tree.map((n) => n.name)).toEqual(['alpha', 'beta.md', 'zeta.md'])
        expect(tree[0]?.children.map((n) => n.name)).toEqual(['one.md', 'two.md'])
    })

    it('gives a leaf no children, so a folder and a file are distinguishable', () => {
        const tree = fileTree(['notes.md'])
        expect(tree[0]?.children).toEqual([])
    })

    it('ignores empty and stray segments rather than inventing a blank node', () => {
        const tree = fileTree(['', '/leading.md', 'trailing/', 'ok.md'])
        expect(tree.map((n) => n.name)).toEqual(['leading.md', 'ok.md', 'trailing'])
    })

    it('is order-independent, so adding a file does not reshuffle the rail', () => {
        const a = fileTree(['b/2.md', 'a/1.md', 'c.md'])
        const b = fileTree(['c.md', 'a/1.md', 'b/2.md'])
        expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    })

    it('returns nothing for no paths', () => {
        expect(fileTree([])).toEqual([])
    })
})

describe('flattenTree', () => {
    const paths = ['a/b/deep.md', 'a/one.md', 'top.md']

    it('emits every folder and file, with depth for the indent', () => {
        // Folders sort before files at every level, so `b` precedes `one.md`
        // inside `a` even though `one.md` sorts first alphabetically.
        expect(flattenTree(fileTree(paths))).toEqual([
            { kind: 'folder', name: 'a', path: 'a', depth: 0 },
            { kind: 'folder', name: 'b', path: 'a/b', depth: 1 },
            { kind: 'file', name: 'deep.md', path: 'a/b/deep.md', depth: 2 },
            { kind: 'file', name: 'one.md', path: 'a/one.md', depth: 1 },
            { kind: 'file', name: 'top.md', path: 'top.md', depth: 0 },
        ])
    })

    it('keeps a collapsed folder but drops everything inside it', () => {
        const rows = flattenTree(fileTree(paths), ['a'])
        expect(rows.map((r) => r.path)).toEqual(['a', 'top.md'])
    })

    it('collapsing a nested folder does not collapse its parent', () => {
        const rows = flattenTree(fileTree(paths), ['a/b'])
        expect(rows.map((r) => r.path)).toEqual(['a', 'a/b', 'a/one.md', 'top.md'])
    })
})
