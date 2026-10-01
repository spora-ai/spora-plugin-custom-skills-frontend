/**
 * The locale every `md-editor-v3` component is rendered with.
 *
 * The library's default locale table is `zh-CN`, so a `<MdEditor>` or
 * `<MdPreview>` without an explicit `:language` renders its chrome in Chinese —
 * a fenced code block's copy button reads `复制代码` inside an otherwise English
 * panel. The English table ships in the package, so the prop is the only lever,
 * and it has to be passed on every component rather than once at a parent:
 * neither component inherits it.
 *
 * Named rather than inlined so the two surfaces cannot disagree, and so a test
 * can assert the literal at every call site.
 */
export const MARKDOWN_LOCALE = 'en-US'
