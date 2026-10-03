/**
 * The create/rename dialog's path rules.
 *
 * These mirror `CustomSkillProvider::isSafePath` on the PHP side. The duplication
 * is deliberate: `files` is written as one map, so a path the server rejects fails
 * the whole save and not just the file being added, and the dialog is the only
 * layer that knows which part the operator got wrong.
 */
import { describe, it, expect } from 'vitest'
import {
    CONVENTIONAL_SKILL_FOLDERS,
    fileFolderOptions,
    fileNameProblem,
    fileNameProblemText,
    formatJsonForPreview,
    joinFilePath,
    looksBinary,
    previewModeFor,
    suggestFileName,
} from '../../src/lib/skillFormat'

const taken = ['SKILL.md', 'notes-2.md', 'references/REFERENCE.md']

describe('joinFilePath', () => {
    it('is the bare name at the root', () => {
        expect(joinFilePath('', 'REFERENCE.md')).toBe('REFERENCE.md')
    })

    it('puts the name inside the folder, tolerating stray slashes', () => {
        expect(joinFilePath('references', 'REFERENCE.md')).toBe('references/REFERENCE.md')
        expect(joinFilePath('/references/', 'REFERENCE.md')).toBe('references/REFERENCE.md')
    })
})

describe('fileNameProblem', () => {
    it('accepts a plain name in a plain folder', () => {
        expect(fileNameProblem('invoice.md', 'examples', taken)).toBeNull()
        expect(fileNameProblem('extract.py', 'scripts', taken)).toBeNull()
        expect(fileNameProblem('notes-3.md', '', taken)).toBeNull()
    })

    it('rejects an empty name', () => {
        expect(fileNameProblem('', 'references', taken)).toBe('empty')
    })

    it('rejects a name carrying its own separator, since the folder is a field', () => {
        // The failure this guards is silent: `a/b.md` typed into the name field would
        // otherwise become a path with a folder the operator did not choose.
        expect(fileNameProblem('a/b.md', '', taken)).toBe('has-separator')
    })

    it('rejects traversal in the name', () => {
        expect(fileNameProblem('..', '', taken)).toBe('traversal')
        expect(fileNameProblem('.', '', taken)).toBe('traversal')
    })

    it('rejects a backslash, which the server would keep as part of the name', () => {
        expect(fileNameProblem('a\\b.md', '', taken)).toBe('backslash')
    })

    it('rejects surrounding space, so the stored path is what was typed', () => {
        expect(fileNameProblem(' notes.md', '', taken)).toBe('padded')
        expect(fileNameProblem('notes.md ', '', taken)).toBe('padded')
    })

    it('rejects control characters', () => {
        expect(fileNameProblem('no\u0007tes.md', '', taken)).toBe('control')
    })

    it('rejects a folder that escapes the skill', () => {
        expect(fileNameProblem('x.md', '../secrets', taken)).toBe('bad-folder')
        expect(fileNameProblem('x.md', 'references/../../etc', taken)).toBe('bad-folder')
        expect(fileNameProblem('x.md', 'references\\windows', taken)).toBe('backslash')
    })

    it('rejects an empty segment in the folder, which the server also rejects', () => {
        // `joinFilePath` would store `a//b/x.md` and `isSafePath` refuses an empty
        // segment, so accepting it here costs a whole save rather than one file.
        expect(fileNameProblem('x.md', 'a//b', taken)).toBe('bad-folder')
    })

    it('forgives a leading or trailing slash on the folder', () => {
        expect(fileNameProblem('x.md', '/references/', taken)).toBeNull()
    })

    it('rejects a path another file already occupies', () => {
        expect(fileNameProblem('REFERENCE.md', 'references', taken)).toBe('duplicate')
        expect(fileNameProblem('notes-2.md', '', taken)).toBe('duplicate')
        // The same name in a different folder is a different file.
        expect(fileNameProblem('REFERENCE.md', 'assets', taken)).toBeNull()
    })

    it('lets a renamed file keep its own path', () => {
        expect(fileNameProblem('notes-2.md', '', taken, 'notes-2.md')).toBeNull()
        // …but not take over a different one's.
        expect(fileNameProblem('notes-2.md', '', taken, 'references/REFERENCE.md')).toBe('duplicate')
    })

    it('has a sentence for every problem it can return', () => {
        const problems = [
            'empty', 'has-separator', 'traversal', 'backslash',
            'control', 'padded', 'bad-folder', 'duplicate',
        ] as const
        for (const problem of problems) {
            expect(fileNameProblemText(problem).length).toBeGreaterThan(0)
        }
    })
})

describe('fileFolderOptions', () => {
    it('offers the root, then existing folders, then the spec conventions', () => {
        expect(fileFolderOptions(['examples'])).toEqual([
            { value: '', label: 'Skill root' },
            { value: 'examples', label: 'examples/' },
            { value: 'references', label: 'references/' },
            { value: 'scripts', label: 'scripts/' },
            { value: 'assets', label: 'assets/' },
        ])
    })

    it('does not offer a convention twice when the skill already has it', () => {
        const options = fileFolderOptions(['references'])
        expect(options.filter((option) => option.value === 'references')).toHaveLength(1)
    })

    it('sorts existing folders, so the picker is stable as files are added', () => {
        expect(fileFolderOptions(['zebra', 'apple']).map((option) => option.value)).toEqual([
            '', 'apple', 'zebra', ...CONVENTIONAL_SKILL_FOLDERS,
        ])
    })
})

describe('suggestFileName', () => {
    it('suggests a free name, and never one already taken', () => {
        expect(suggestFileName(['SKILL.md'])).toBe('notes-2.md')
        expect(suggestFileName(['SKILL.md', 'notes-2.md', 'notes-3.md'])).toBe('notes-4.md')
    })
})

/** A NUL byte, the decisive marker. Written as an escape on purpose. */
const NUL = '\u0000'

describe('looksBinary', () => {
    it('treats a NUL byte as decisive', () => {
        expect(looksBinary(`PNG${NUL}${NUL}binary`)).toBe(true)
    })

    it('does not call ordinary text binary', () => {
        expect(looksBinary('# Title\n\nA paragraph with prose.\n')).toBe(false)
        // Tab, newline and carriage return are whitespace, not control noise.
        expect(looksBinary('a\tb\r\nc')).toBe(false)
        // Non-ASCII prose is text; a code point does not make it binary.
        expect(looksBinary('Größe: 12 µm — 日本語')).toBe(false)
        expect(looksBinary('')).toBe(false)
    })

    it('catches a blob with no NUL by its control-character ratio', () => {
        expect(looksBinary('\u0001\u0002\u0003\u0004\u0005\u0006')).toBe(true)
        // One odd byte inside prose is not a blob.
        expect(looksBinary(`a long line of prose \u0007 and more prose`)).toBe(false)
    })
})

describe('previewModeFor', () => {
    it('renders markdown', () => {
        expect(previewModeFor('SKILL.md', '# Title')).toBe('markdown')
        expect(previewModeFor('references/GUIDE.MD', '# Title')).toBe('markdown')
    })

    it('formats JSON, so a config file is readable rather than a wall of text', () => {
        expect(previewModeFor('assets/data.json', '{"a":1}')).toBe('formatted')
        expect(previewModeFor('assets/data.jsonc', '{}')).toBe('formatted')
    })

    it('shows anything else as source', () => {
        expect(previewModeFor('scripts/extract.py', 'print()')).toBe('source')
        expect(previewModeFor('references/notes.txt', 'plain')).toBe('source')
        expect(previewModeFor('Makefile', 'all:\n\techo hi')).toBe('source')
    })

    it('decides binary from the bytes, not the extension', () => {
        // An extension says what a file is meant to be; the bytes say what it is.
        // A `.txt` that is really a PDF is the case a name-only rule gets wrong.
        expect(previewModeFor('assets/data.txt', `PDF${NUL}`)).toBe('binary')
        expect(previewModeFor('data.json', `PDF${NUL}`)).toBe('binary')
    })
})

describe('formatJsonForPreview', () => {
    it('reindents valid JSON', () => {
        expect(formatJsonForPreview('{"a":1,"b":[2,3]}')).toBe(
            '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}',
        )
    })

    it('returns null rather than the input, so a broken file is shown as written', () => {
        expect(formatJsonForPreview('{"a": 1,')).toBeNull()
        expect(formatJsonForPreview('not json at all')).toBeNull()
    })

    it('handles a scalar document, which JSON allows', () => {
        expect(formatJsonForPreview('42')).toBe('42')
        expect(formatJsonForPreview('"x"')).toBe('"x"')
    })
})
