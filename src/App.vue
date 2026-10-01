<script setup lang="ts">
import SkillsPage from './pages/SkillsPage.vue'
import './style.css'

/**
 * Entry component.
 *
 * The `#spora-plugin-custom-skills` wrapper is the CSS scope every Tailwind
 * utility in the bundle nests beneath (see `tailwind.config.ts → important`);
 * removing it silently unscopes the plugin's CSS into the host, which is what
 * `scripts/smoke.js` fails the build for.
 *
 * The router and `hostContext` are installed in `main.ts → mount()`. A second
 * `createRouter()` here would never be `app.use()`'d, leaving `useRoute()` /
 * `useRouter()` in the descendants unbound and silently swallowing navigation.
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
