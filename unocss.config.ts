import { defineConfig, presetWind4 } from 'unocss';
import { LINK_INDICATOR_CSS } from './src/lib/components/links/indicator';

/**
 * UnoCSS 66 / presetWind4 со встроенным reset'ом (Tailwind v4 preflight).
 * Цвета — семантические токены в духе shadcn: bg-background, text-foreground,
 * bg-primary text-primary-foreground, text-muted-foreground, border-border, ring-ring…
 * Сами значения (две темы) — CSS-переменные в src/index.css.
 */
const v = (name: string) => `var(--${name})`;
const pair = (name: string) => ({ 
  DEFAULT: v(name), 
  foreground: v(`${name}-foreground`) 
});

export default defineConfig({
  // app.html — шаблон SvelteKit, а не модуль Vite: ни сборка, ни transformIndexHtml
  // его не видят (sveltejs/kit#8269), поэтому классы <html>/<body> сканируются с диска.
  // https://unocss.dev/guide/extracting#extracting-from-filesystem
  content: { filesystem: ['src/app.html'] },
  presets: [
    presetWind4({ 
      preflights: { reset: true } 
    })
  ],
  // Вид состояния ссылок `asLink`/`asModalLink` (спиннер, «!», %): элемент
  // принадлежит потребителю, поэтому правило одно и глобальное.
  preflights: [{ getCSS: () => LINK_INDICATOR_CSS }],
  shortcuts: {
    'nav-pill': 'rounded-full px-3.5 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
    'nav-pill-active': 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground',
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
      // раньше ключ fontFamily wind4 игнорировал, и font-display фактически был Manrope —
      // сохраняем сложившийся вид; Playfair подключён в index.html, включить можно здесь.
      display: 'Manrope, ui-sans-serif, system-ui, sans-serif',
      sans: 'Manrope, ui-sans-serif, system-ui, sans-serif',
    },
  },
});
