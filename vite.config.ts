import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

/**
 * Vite config for the Custom Skills IIFE bundle.
 *
 * `formats: ['iife']` + `name: 'SporaAppCustomSkills'` produce the single
 * self-contained script the host registry `import()`s, exposed on
 * `window.<name>` — PascalCase of the slug is the convention.
 * `build.outDir: 'frontend'` is the directory `SporaPluginFrontendInstaller` copies
 * into `public/plugins/<slug>/`, so the build output must live there.
 */
export default defineConfig({
    plugins: [vue()],
    // Must match the host's dev proxy prefix (`SPORA_PLUGIN_DEV_PORTS=
    // custom-skills:5190` → the host's Vite forwards `/plugins/<slug>/*` here).
    // Otherwise the browser resolves `/src/App.vue` against the host's :5173, the
    // sub-requests 404, and `window.SporaAppCustomSkills` is never assigned because
    // the module's top-level code never finishes. The slug mirrors the PHP plugin's
    // `plugin.json#slug`; the build output is unaffected (a single self-contained
    // `main.js`).
    base: '/plugins/custom-skills/',
    build: {
        outDir: 'frontend',
        emptyOutDir: false,
        lib: {
            entry: 'src/main.ts',
            formats: ['iife'],
            name: 'SporaAppCustomSkills',
            fileName: () => 'main.js',
        },
        rollupOptions: {
            // The host publishes exactly five globals — `Vue`, `Pinia`, `VueRouter`,
            // `VueDraggablePlus`, `MdEditorV3` (spora-frontend/src/utils/
            // publishPluginGlobals.ts) — so only those may be externalised.
            // `lucide-vue-next` and `dompurify` are deliberately BUNDLED: the host
            // does not publish them, and a bundle externalising an unpublished global
            // throws on import, so the panel would be unreachable, not degraded.
            // (spora-plugin-memories-frontend does the same. Also: `md-editor-v3`
            // mounts CodeMirror 6 + katex + mermaid — bundling it would add ~1 MB.)
            external: [
                'vue',
                'pinia',
                'vue-router',
                'md-editor-v3',
            ],
            output: {
                // `extend` must stay at its default: the host loads this bundle via
                // dynamic `import()` (module scope, `this` is `undefined`), so
                // `extend: true` would emit `this.<name> = ...` and throw at load.
                globals: {
                    vue: 'window.Vue',
                    pinia: 'window.Pinia',
                    'vue-router': 'window.VueRouter',
                    'md-editor-v3': 'window.MdEditorV3',
                },
                assetFileNames: (asset) => {
                    if (asset.name && asset.name.endsWith('.css')) {
                        return 'style.css'
                    }
                    return asset.name ?? '[name][extname]'
                },
            },
        },
    },
    server: {
        port: 5190,
        strictPort: false,
        cors: true,
    },
    test: {
        environment: 'happy-dom',
        globals: true,
        // Pulls in the `md-editor-v3` stub before any component imports it: the real
        // library mounts CodeMirror 6 and fetches highlight.js / katex / mermaid CSS
        // from unpkg.com, neither of which works under happy-dom.
        setupFiles: ['./tests/setup.ts'],
        // `lcov` is required by the SonarSource action's
        // `sonar.javascript.lcov.reportPaths=coverage/lcov.info`; the v8 provider
        // does not emit it by default.
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov', 'clover', 'json'],
            reportsDirectory: './coverage',
            include: ['src/**/*.{ts,vue}'],
            // The side-effecting dev-only bootstrap: only index.html (`npm run dev`)
            // loads it, production ships main.ts. Excluded so SonarCloud's
            // "new code ≥80% coverage" gate measures production code.
            exclude: ['src/dev-main.ts'],
        },
    },
})
