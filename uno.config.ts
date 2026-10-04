import { defineConfig, presetWind4 } from 'unocss'

/**
 * UnoCSS 66 / presetWind4 со встроенным reset'ом (Tailwind v4 preflight).
 * Цвета — семантические токены в духе shadcn: bg-background, text-foreground,
 * bg-primary text-primary-foreground, text-muted-foreground, border-border, ring-ring…
 * Сами значения (две темы) — CSS-переменные в src/lib/styles/tokens.css.
 */
const v = (name: string) => `var(--${name})`
const pair = (name: string) => ({
  DEFAULT: v(name),
  foreground: v(`${name}-foreground`),
})

export default defineConfig({
  presets: [
    presetWind4({
      preflights: { reset: true },
    }),
  ],
  shortcuts: {
    'nav-pill':
      'rounded-full px-3.5 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
    'nav-pill-active':
      'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground',
    skeleton: 'animate-pulse rounded-md bg-muted',
  },
  theme: {
    colors: {
      background: v('background'),
      foreground: v('foreground'),
      border: v('border'),
      input: v('input'),
      ring: v('ring'),
      card: pair('card'),
      popover: pair('popover'),
      primary: pair('primary'),
      secondary: pair('secondary'),
      muted: pair('muted'),
      accent: pair('accent'),
      destructive: pair('destructive'),
      success: pair('success'),
      info: pair('info'),
      warning: pair('warning'),
      chart: {
        1: v('chart-1'),
        2: v('chart-2'),
        3: v('chart-3'),
        4: v('chart-4'),
        5: v('chart-5'),
      },
      sidebar: {
        DEFAULT: v('sidebar'),
        foreground: v('sidebar-foreground'),
        primary: v('sidebar-primary'),
        'primary-foreground': v('sidebar-primary-foreground'),
        accent: v('sidebar-accent'),
        'accent-foreground': v('sidebar-accent-foreground'),
        border: v('sidebar-border'),
        ring: v('sidebar-ring'),
      },
    },
    radius: {
      DEFAULT: 'var(--radius)',
      sm: 'calc(var(--radius) - 4px)',
      md: 'calc(var(--radius) - 2px)',
      lg: 'var(--radius)',
      xl: 'calc(var(--radius) + 4px)',
      '2xl': 'calc(var(--radius) + 8px)',
    },
    font: {
      display: 'Manrope, ui-sans-serif, system-ui, sans-serif',
      sans: 'Manrope, ui-sans-serif, system-ui, sans-serif',
    },
  },
})
