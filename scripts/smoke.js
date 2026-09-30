#!/usr/bin/env node
/**
 * Static-analysis smoke check for the production plugin assets.
 *
 * Vue's top-level createApp()/defineComponent() calls need a real renderer,
 * so we inspect the IIFE wrapper instead of evaluating it. The stylesheet
 * checks lock in the plugin boundary: Tailwind utilities must remain scoped
 * beneath the plugin's wrapper id and the host-owned preflight reset must
 * not be emitted. An unscoped Tailwind bundle in the host would override
 * the host SPA's own utilities, and `scripts/clean.js` is the only cheap
 * place to catch it before a release tarball is cut.
 */
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = resolve(here, '..', 'frontend', 'main.js')
const stylesheetPath = resolve(here, '..', 'frontend', 'style.css')

let txt
let css
try {
    ;[txt, css] = await Promise.all([
        readFile(bundlePath, 'utf8'),
        readFile(stylesheetPath, 'utf8'),
    ])
} catch (e) {
    console.error(`smoke: cannot read build output: ${e.message}`)
    process.exit(1)
}

const globalName = 'SporaAppCustomSkills'
const scopeSelector = '#spora-plugin-custom-skills'
const failures = []

// Reject `this.<name>=` (the `extend: true` wrapper shape). Module-scope
// `this` is `undefined` under dynamic `import()`, so the assignment
// throws before any later `window.<name> = SporaApp` can run.
const badWrapper = new RegExp(`\\bthis\\.${globalName}\\s*=`)
if (badWrapper.test(txt)) {
    failures.push(`bundle assigns this.${globalName}= — fails in module scope (dynamic import). Drop \`output.extend: true\` from vite.config.ts.`)
}

// Anchor the binding to its first occurrence so the later
// `window.<name> = SporaApp` in src/main.ts can't mask a missing wrapper.
const bindingRe = new RegExp(`(?:^|;|\\n)\\s*(?:var\\s+${globalName}\\s*=|window\\.${globalName}\\s*=)`, 'm')
const firstBindingMatch = txt.match(bindingRe)
if (!firstBindingMatch) {
    failures.push(`bundle does not declare ${globalName} via \`var ${globalName}=\` or \`window.${globalName}=\``)
}

const mountRe = /\bmount\s*\(\s*[a-zA-Z_$][\w$]*\s*,\s*[a-zA-Z_$][\w$]*\s*\)/
if (!mountRe.test(txt)) {
    failures.push('bundle does not define `mount(a, b)` with two parameters')
}

const unmountRe = /\bunmount\s*\(\s*[a-zA-Z_$][\w$]*\s*\)/
if (!unmountRe.test(txt)) {
    failures.push('bundle does not define `unmount(a)` with one parameter')
}

if (!css.includes(scopeSelector)) {
    failures.push(`stylesheet does not scope utilities beneath ${scopeSelector}`)
}

const unscopedDisplayUtilityRe = /(?:^|})\s*\.(?:hidden|flex|inline-flex)\s*\{\s*display\s*:/
if (unscopedDisplayUtilityRe.test(css)) {
    failures.push('stylesheet contains an unscoped Tailwind display utility')
}

const preflightRe = /box-sizing\s*:\s*border-box;\s*border-width\s*:\s*0;\s*border-style\s*:\s*solid/
if (preflightRe.test(css)) {
    failures.push('stylesheet contains the Tailwind preflight reset')
}

// The externals contract in vite.config.ts is a load-time dependency on
// the host publishing these globals first. If one of them got inlined
// (or dropped) the IIFE wrapper's argument list changes shape and the
// plugin silently stops sharing the host's instances.
for (const global of ['window.Vue', 'window.Pinia', 'window.VueRouter', 'window.MdEditorV3']) {
    if (!txt.includes(global)) {
        failures.push(`bundle does not reference ${global} — the external is no longer wired through output.globals`)
    }
}

if (failures.length > 0) {
    console.error('smoke: FAIL')
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
}

console.log('smoke: OK')
