import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

/**
 * Minimal flat-config ESLint setup. Mirrors the host SPA's defaults
 * (TS strict, no unused, vue parser) but keeps the plugin-specific
 * nuances: `*.vue` files use vue-eslint-parser; TS files use the
 * typescript-eslint parser.
 */
export default [
    js.configs.recommended,
    ...tseslint.configs.recommended,
    ...vue.configs['flat/recommended'],
    {
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                parser: tseslint.parser,
                ecmaVersion: 'latest',
                sourceType: 'module',
                extraFileExtensions: ['.vue'],
            },
            globals: {
                URLSearchParams: 'readonly',
                window: 'readonly',
                document: 'readonly',
                console: 'readonly',
                globalThis: 'readonly',
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            // TypeScript already enforces undefined-identifier checks via
            // `vue-tsc`; `no-undef` is redundant for browser/Vue code and
            // false-positives on DOM types like HTMLDialogElement and Event.
            'no-undef': 'off',
            'vue/multi-word-component-names': 'off',
            // The host SPA uses 4-space nesting inside <template> blocks for
            // readability when mixing nested v-for/v-if. We match that here
            // rather than fight eslint-plugin-vue's 2-space default.
            'vue/html-indent': ['warn', 4, { baseIndent: 1 }],
            'vue/html-closing-bracket-newline': 'off',
            'vue/max-attributes-per-line': 'off',
            'vue/singleline-html-element-content-newline': 'off',
            'vue/html-self-closing': 'off',
        },
    },
    {
        ignores: ['node_modules/', 'dist/', 'frontend/', '.vite/', 'coverage/'],
    },
]
