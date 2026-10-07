/**
 * probe: что реально генерирует официальный UnoCSS (presetWind4) под тему проекта.
 * Тема повторена здесь литералом (uno.config.ts — TS, node без лоадера его не читает),
 * сам конфиг НЕ меняется и не импортируется: probe только печатает CSS по кандидатам.
 *
 *   node probes/uno-probe.mjs 'z-200' 'data-[starting-style]:opacity-0' ...
 */
import { createGenerator } from '@unocss/core'
import * as wind from '@unocss/preset-wind4'

const v = (name) => `var(--${name})`
const pair = (name) => ({ DEFAULT: v(name), foreground: v(`${name}-foreground`) })

const preset = wind.presetWind4 ?? wind.default
const uno = await createGenerator({
  presets: [preset({ preflights: { reset: false } })],
  shortcuts: {},
  theme: {
    colors: {
      background: v('background'), foreground: v('foreground'), border: v('border'), input: v('input'), ring: v('ring'),
      card: pair('card'), popover: pair('popover'), primary: pair('primary'), secondary: pair('secondary'),
      muted: pair('muted'), accent: pair('accent'), destructive: pair('destructive'), success: pair('success'),
      info: pair('info'), warning: pair('warning'),
      chart: { 1: v('chart-1'), 2: v('chart-2'), 3: v('chart-3'), 4: v('chart-4'), 5: v('chart-5') },
      sidebar: {
        DEFAULT: v('sidebar'), foreground: v('sidebar-foreground'), primary: v('sidebar-primary'),
        'primary-foreground': v('sidebar-primary-foreground'), accent: v('sidebar-accent'),
        'accent-foreground': v('sidebar-accent-foreground'), border: v('sidebar-border'), ring: v('sidebar-ring'),
      },
    },
    radius: {
      DEFAULT: 'var(--radius)', sm: 'calc(var(--radius) - 4px)', md: 'calc(var(--radius) - 2px)',
      lg: 'var(--radius)', xl: 'calc(var(--radius) + 4px)', '2xl': 'calc(var(--radius) + 8px)',
    },
    font: { display: 'Manrope, ui-sans-serif, system-ui, sans-serif', sans: 'Manrope, ui-sans-serif, system-ui, sans-serif' },
  },
})

const tests = process.argv.slice(2)
const out = await uno.generate(tests.join(' '), { preflights: false })
console.log(out.css)
const missing = tests.filter((t) => !out.matched.has(t))
if (missing.length) console.log('\n/* НЕ сгенерировано: ' + missing.join(' | ') + ' */')
