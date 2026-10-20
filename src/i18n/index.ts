/**
 * i18n instance — Composition API only (`legacy: false`).
 *
 * The plugin builds its *own* instance from its *own* catalogue rather
 * than sharing the host's: the host does not publish its instance, so
 * reaching into it would couple this plugin's catalogue lifetime to
 * the host's.
 *
 * The catalogues are bundled rather than fetched: `import.meta.glob`
 * with `eager: true` inlines every `src/locales/*.json` at build time,
 * so a locale switch never waits on the network.
 *
 * `en.json` is a generated identity map (`"Save": "Save"`), so the
 * fallback chain costs nothing and an unmigrated key renders as the
 * English source rather than as a raw key.
 */
import { createI18n, type Composer } from 'vue-i18n'

export const FALLBACK_LOCALE = 'en'

const catalogues = import.meta.glob<Record<string, string>>('../locales/*.json', {
    eager: true,
    import: 'default',
})

export const messages = Object.fromEntries(
    Object.entries(catalogues).map(([path, catalogue]) => [
        path.slice(path.lastIndexOf('/') + 1, -'.json'.length),
        catalogue,
    ]),
)

/**
 * The composer of the mounted app.
 *
 * The Pinia stores and `lib/skillFormat.ts` translate as well, and
 * neither has a component instance to call `useI18n()` from — so the
 * instance the app runs on is recorded here when it is created.
 */
let composer: Composer | null = null

export function createPluginI18n(locale: string) {
    const instance = createI18n({
        legacy: false,
        locale,
        fallbackLocale: FALLBACK_LOCALE,
        messages,
    })
    composer = instance.global
    return instance
}

/**
 * Translate outside a component.
 *
 * The composer's own `t` is read through an alias: the extractor
 * treats every call named `t` as a catalogue lookup, and a call with
 * a runtime key would be reported as a dynamic key it cannot harvest.
 *
 * The params are forwarded so a message outside a component can carry a
 * placeholder the same way a component's own `t` can.
 */
export function t(key: string, params?: Record<string, unknown>): string {
    if (composer === null) return key
    const translate = composer.t
    return params === undefined ? translate(key) : translate(key, params)
}
