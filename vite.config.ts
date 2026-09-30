import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

/**
 * Vite config for the Custom Skills IIFE bundle.
 *
 * Three things matter here:
 *
 *  1. `build.lib.formats: ['iife']` produces a single self-contained script
 *     that the host SPA can dynamic `import()`. ES modules / UMD would break
 *     the IIFE semantics the host registry expects.
 *  2. `build.lib.name: 'SporaAppCustomSkills'` matches
 *     `registry.ts → globalFor()` in `spora-frontend`. The IIFE wrapper
 *     exposes the named export on `window.<name>`. PascalCase of the slug
 *     (`custom-skills`) is the convention — do not use kebab-case here.
 *  3. `build.rollupOptions.external` keeps the shared libraries out of the
 *     bundle so the host SPA's instances are shared. Sharing Pinia is what
 *     lets the plugin read auth/theme state; sharing Vue is what prevents
 *     the slot from re-creating a second app instance; sharing vue-router
 *     means the plugin's local <RouterView> resolves routes against the
 *     host router; sharing md-editor-v3 avoids re-mounting CodeMirror 6.
 *
 * `build.outDir: 'frontend'` writes `main.js` + `style.css` directly into
 * this repo's `frontend/` directory — that's the directory
 * `SporaPluginFrontendInstaller` copies into `public/plugins/<slug>/`.
 *
 * The `test` block is a Vitest extension to Vite's config. Vitest reads it
 * when running `npm test`; Vite ignores it on `npm run build`. We pass it
 * through via spread so both consumers see the same shape.
 */
export default defineConfig({
    plugins: [vue()],
    // `base` is the public URL prefix Vite uses for absolute paths in the
    // dev-server-served HTML and for the HMR client. In standalone dev
    // (`npm run dev`) it controls where the sandbox is served; in the
    // host-proxied dev flow it MUST match the host's proxy prefix
    // (`SPORA_PLUGIN_DEV_PORTS=custom-skills:5190` on the host → the
    // host's Vite forwards `/plugins/<slug>/*` to this server).
    //
    // Without this, the transformed module imports reference absolute
    // paths like `/src/App.vue` and `/node_modules/.vite/deps/vue.js`,
    // which the browser resolves against the document's origin (the
    // host's :5173, not this server's :5190). The host doesn't have
    // `/src/App.vue` and the sub-requests 404 silently —
    // `window.SporaAppCustomSkills` is never assigned because the
    // module's top-level code never finishes executing.
    //
    // The slug here mirrors the PHP plugin's `plugin.json#slug` — they're
    // a coupled pair, not derivable from package metadata. The build
    // output is unaffected: the IIFE lib emits a single self-contained
    // `main.js` that doesn't reference its own base.
    base: '/plugins/custom-skills/',
    build: {
        // Write the IIFE bundle into `frontend/`. `SporaPluginFrontendInstaller`
        // (in spora-installer) copies the package's `frontend/` directory
        // verbatim into `public/plugins/<slug>/` at install time, so the
        // build output MUST live there. The `npm run clean` script removes
        // `frontend/main.js` if you need to rebuild from scratch.
        outDir: 'frontend',
        emptyOutDir: false,
        lib: {
            entry: 'src/main.ts',
            formats: ['iife'],
            name: 'SporaAppCustomSkills',
            fileName: () => 'main.js',
        },
        rollupOptions: {
            // Shared with the host SPA. `md-editor-v3` mounts CodeMirror 6
            // + highlight.js / katex / mermaid — emitting it inside the
            // plugin's IIFE would inflate the bundle to ~1 MB and cause
            // CSS asset collisions with the host. Externalising keeps
            // the host-side installation the single source of truth.
            //
            // `lucide-vue-next` and `dompurify` are deliberately BUNDLED, not
            // externalised: the host does not publish them, and a bundle that
            // externalises an unpublished global throws on import — the panel
            // would be unreachable rather than degraded. spora-plugin-memories-frontend
            // bundles these two for the same reason; match it.
            external: [
                'vue',
                'pinia',
                'vue-router',
                'md-editor-v3',
            ],
            output: {
                // `extend` must stay at its default. The host loads this
                // bundle via dynamic `import()` (module scope, top-level
                // `this` is `undefined`); `extend: true` would emit
                // `this.<name> = ...` and throw at load.
                //
                // `window.<external>` substitution avoids ReferenceErrors
                // — bare identifiers aren't free variables in module
                // scope. Host publishes the globals first.
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
        // Pull in the `md-editor-v3` stub before any component imports it.
        // The real library mounts CodeMirror 6 + tries to fetch highlight.js
        // / katex / mermaid CSS from unpkg.com — neither works under
        // happy-dom, so we replace it with a tiny textarea + div in
        // `tests/setup.ts`.
        setupFiles: ['./tests/setup.ts'],
        // Emit `coverage/lcov.info` so SonarCloud can read it. The v8
        // provider only writes coverage-final.json + clover.xml by default;
        // we explicitly add `lcov` here to satisfy the SonarSource action's
        // `sonar.javascript.lcov.reportPaths=coverage/lcov.info` setting.
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov', 'clover', 'json'],
            reportsDirectory: './coverage',
            include: ['src/**/*.{ts,vue}'],
            // dev-main.ts is the side-effecting Vue bootstrap that mounts
            // the app into the dev sandbox's #app node. It imports the
            // document/window globals and is only loaded by index.html
            // in `npm run dev` mode — production ships main.ts instead.
            // Excluding it from coverage measurement keeps SonarCloud's
            // "new code must have ≥80% coverage" gate honest: dev tooling
            // isn't production code.
            exclude: ['src/dev-main.ts'],
        },
    },
})
