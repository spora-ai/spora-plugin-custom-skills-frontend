import type { Config } from 'tailwindcss'
import { fontFamily } from 'tailwindcss/defaultTheme'

/**
 * Tailwind config for the Custom Skills plugin frontend.
 *
 * The theme tokens (colours, font sizes, border radius) intentionally
 * mirror the host SPA's `tailwind.config.ts` so plugins render with the
 * same design language without the host needing to know about the
 * plugin's source files.
 *
 * IMPORTANT — the CSS variables themselves (--primary, --foreground, etc.)
 * are NOT defined here. They live on `:root` and `.dark` in the host SPA's
 * compiled CSS. Because the plugin's bundle is mounted into a slot owned by
 * the host, those variables are already in scope by the time the plugin's
 * CSS resolves `hsl(var(--primary))`. Theme switching on the host cascades
 * into the plugin for free.
 *
 * `important: '#spora-plugin-custom-skills'` matches the wrapper id
 * `App.vue` renders. `scripts/smoke.js` asserts the emitted stylesheet
 * actually carries that prefix — an unscoped Tailwind bundle in the host
 * would override the host SPA's own utilities.
 */
export default {
    content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
    // Plugin CSS shares the host document, so keep resets and utilities contained.
    corePlugins: { preflight: false },
    important: '#spora-plugin-custom-skills',
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: ['Barlow', ...fontFamily.sans],
            },
            colors: {
                border: 'hsl(var(--border))',
                input: 'hsl(var(--input))',
                ring: 'hsl(var(--ring))',
                background: 'hsl(var(--background))',
                foreground: 'hsl(var(--foreground))',
                // The host defines NO `--card` variable — its `:root` stops at
                // `--accent-foreground`. Its own theme maps the card utility as
                // `--color-card: hsl(var(--background))` (spora-frontend
                // src/style.css:117), i.e. the card IS the background.
                //
                // These two used to read `hsl(var(--card))`, which compiles to
                // an invalid colour because the variable is undefined: every
                // `bg-card` surface — the editor pane, the viewer, the cards
                // and the delete-confirmation dialog — silently rendered
                // transparent. It went unnoticed because the panels sit on
                // `bg-background`, so card and transparent look identical
                // everywhere except the dialog.
                card: 'hsl(var(--background))',
                'card-foreground': 'hsl(var(--foreground))',
                primary: {
                    DEFAULT: 'hsl(var(--primary))',
                    foreground: 'hsl(var(--primary-foreground))',
                },
                secondary: {
                    DEFAULT: 'hsl(var(--secondary))',
                    foreground: 'hsl(var(--secondary-foreground))',
                },
                destructive: {
                    DEFAULT: 'hsl(var(--destructive))',
                    foreground: 'hsl(var(--destructive-foreground))',
                },
                muted: {
                    DEFAULT: 'hsl(var(--muted))',
                    foreground: 'hsl(var(--muted-foreground))',
                },
                accent: {
                    DEFAULT: 'hsl(var(--accent))',
                    foreground: 'hsl(var(--accent-foreground))',
                },
            },
            borderRadius: {
                lg: 'var(--radius)',
                md: 'calc(var(--radius) - 2px)',
                sm: 'calc(var(--radius) - 4px)',
            },
        },
    },
    plugins: [],
} satisfies Config
