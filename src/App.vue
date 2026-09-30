<script setup lang="ts">
import SkillsPage from './pages/SkillsPage.vue'
import './style.css'

/**
 * App.vue — entry component.
 *
 * The `#spora-plugin-custom-skills` wrapper is the CSS scope every
 * Tailwind utility in the bundle is nested beneath (see
 * `tailwind.config.ts → important`). Removing the id, or rendering the
 * page without it, silently unscopes the plugin's CSS into the host —
 * which is exactly what `scripts/smoke.js` fails the build for.
 *
 * The plugin-local router is built and installed in `main.ts → mount()`
 * (and mirrored in `dev-main.ts` for the dev sandbox). This file
 * intentionally does not create a router of its own: a second
 * `createRouter()` instance here would never be `app.use()`'d, leaving
 * `useRoute()`/`useRouter()` in the descendants unbound and silently
 * swallowing navigation.
 *
 * `hostContext` is provided via `provide(...)` in `main.ts → mount()`
 * so descendants (`SkillEditor`, the page) can inject it without
 * prop-drilling.
 */

const props = defineProps<{
    hostContext: import('./shims').PluginHostContext
}>()

defineExpose({ hostContext: props.hostContext })
</script>

<template>
    <div id="spora-plugin-custom-skills">
        <SkillsPage />
    </div>
</template>
