/**
 * Механический чек-лист «b1 против b2»: печатает ТОЛЬКО проверяемые факты,
 * без оценок. Нужен, чтобы спор о ветках решался по критериям, а не по тому,
 * кто увереннее напишет отчёт.
 *
 * Запуск из любого дерева:
 *   node probes/ab-check.mjs --tree . --branch b1
 *   node probes/ab-check.mjs --tree /tmp/b2ref --branch b2
 *
 * Проверки, требующие браузера (видны ли скелетоны, дубль строки, гибрид
 * хранилища), здесь НЕ дублируются — их печатают probes/ab-paginator.mjs,
 * probes/ab-dup-rows.mjs и probes/pag-skel.mjs; их числа сведены в отчёте.
 */
import { execSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { createGenerator } from '@unocss/core'
import * as wind from '@unocss/preset-wind4'

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? def : process.argv[i + 1]
}
const TREE = arg('tree', '.')
const BRANCH = arg('branch', 'HEAD')
const P = `${TREE}/`
const sh = (cmd) => {
  try {
    return execSync(cmd, { cwd: TREE, encoding: 'utf8' }).trim()
  } catch {
    return 'n/a'
  }
}
const rd = (p) => (existsSync(P + p) ? readFileSync(P + p, 'utf8') : null)
const count = (p, re) => {
  const s = rd(p)
  return s === null ? 'n/a' : (s.match(re) ?? []).length
}
const rows = []
const fact = (k, v) => rows.push([k, String(v)])

// ── 1. Оформление ────────────────────────────────────────────────────────────
const css = rd('src/app.css') ?? ''
const withoutTokens = css.replace(/:root[^{]*\{[\s\S]*?\n\}/g, '').replace(/html\[data-theme[^{]*\{[\s\S]*?\n\}/g, '')
fact('app.css: строк', css.split('\n').length)
fact('app.css: правил вне блоков токенов', (withoutTokens.match(/\{/g) ?? []).length)
fact('app.css: @keyframes', (css.match(/@keyframes\s+[-_a-zA-Z]/g) ?? []).length)

const srcFiles = sh(`find src -type f \\( -name '*.svelte' -o -name '*.ts' -o -name '*.css' \\) -not -path '*/node_modules/*'`)
const keyframeFiles = srcFiles === 'n/a' ? 'n/a' : srcFiles.split('\n').filter((f) => /@keyframes\s+[-_a-zA-Z]/.test(rd(f) ?? '')).join(', ') || '—'
fact('свои @keyframes в src (файлы)', keyframeFiles)
fact('uno.config.ts / unocss.config.ts изменены против базы', sh(`git diff --name-only 8bc00e8..${BRANCH} -- uno.config.ts unocss.config.ts`) || '—')

// ── 2. Классы: что Uno реально не может сгенерировать ────────────────────────
const v = (n) => `var(--${n})`
const pair = (n) => ({ DEFAULT: v(n), foreground: v(`${n}-foreground`) })
const theme = {
  colors: {
    background: v('background'), foreground: v('foreground'), border: v('border'), input: v('input'), ring: v('ring'),
    card: pair('card'), popover: pair('popover'), primary: pair('primary'), secondary: pair('secondary'),
    muted: pair('muted'), accent: pair('accent'), destructive: pair('destructive'), success: v('success'),
    info: v('info'), warning: v('warning'),
    chart: { 1: v('chart-1'), 2: v('chart-2'), 3: v('chart-3'), 4: v('chart-4'), 5: v('chart-5') },
    sidebar: { DEFAULT: v('sidebar'), foreground: v('sidebar-foreground'), primary: v('sidebar-primary'),
      'primary-foreground': v('sidebar-primary-foreground'), accent: v('sidebar-accent'),
      'accent-foreground': v('sidebar-accent-foreground'), border: v('sidebar-border'), ring: v('sidebar-ring') },
  },
  radius: { DEFAULT: 'var(--radius)', sm: 'calc(var(--radius) - 4px)', md: 'calc(var(--radius) - 2px)', lg: 'var(--radius)', xl: 'calc(var(--radius) + 4px)', '2xl': 'calc(var(--radius) + 8px)' },
  font: { display: 'Manrope, ui-sans-serif, system-ui, sans-serif', sans: 'Manrope, ui-sans-serif, system-ui, sans-serif' },
}
try {
  const audit = execSync('node probes/classes-audit.mjs', { cwd: TREE, encoding: 'utf8', maxBuffer: 1 << 24 })
  const head = audit.split('\n')[0]
  const bullets = (header) => {
    const i = audit.indexOf(header)
    if (i === -1) return []
    return audit.slice(i).split('\n').slice(1).filter((l) => l.startsWith('  • ')).map((l) => l.slice(4).split('  ←')[0].trim())
  }
  const markers = bullets('Маркеры вернулись')
  const broken = bullets('НЕ сгенерировано')
  // Легальные шорткаты проекта (nav-pill, skeleton…) — часть дизайн-системы,
  // а не «свой класс»: проверяем их генератором С шорткатами.
  const uno = await createGenerator({
    presets: [wind.presetWind4({ preflights: { reset: false } })],
    shortcuts: {
      'nav-pill': 'rounded-full px-3.5 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
      'nav-pill-active': 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground',
      skeleton: 'animate-pulse rounded-md bg-muted',
    },
    theme,
  })
  const legal = new Set()
  const dead = []
  for (const t of [...markers, ...broken]) {
    const out = await uno.generate(t, { preflights: false })
    if (out.matched.has(t)) legal.add(t)
    else if (!dead.includes(t)) dead.push(t)
  }
  fact('классы: файлов в аудите / токенов', head.replace(/^Файлов: /, ''))
  fact('классы: запретные имена (svои хуки) вне шорткатов', markers.filter((t) => !legal.has(t)).join(', ') || '—')
  fact('классы: токены, которые Uno не генерирует даже с шорткатами', dead.join(', ') || '—')
} catch (e) {
  fact('классы: аудит', `не выполнился: ${String(e).slice(0, 80)}`)
}

// ── 3. Пагинатор: скелетоны и адрес ──────────────────────────────────────────
fact('PageColumns: distributeRoundRobin с !!renderSkeleton', (rd('src/lib/ui/paginator/PageColumns.svelte') ?? '').includes('!!renderSkeleton') ? 'да' : 'нет')
fact('PageList: внешние pendingAbove/pendingBelow', count('src/lib/ui/paginator/PageList.svelte', /pending(Above|Below)/g))
fact('источник: задержка в src/content/items.ts', (rd('src/content/items.ts') ?? '').match(/DEMO_TRANSPORT_MS\s*=\s*\d+|setTimeout\(r,\s*\d+\)/g)?.join(' · ') ?? '—')
fact('ядро/хост: holdPendingFloor|pendingDelayMs', sh(`grep -rl "holdPendingFloor\\|pendingDelayMs" src/lib/paginate src/lib/ui 2>/dev/null | tr '\\n' ' '`) || '—')
const appImp = sh(`grep -rl "from '\\$app/" src/features 2>/dev/null | tr '\\n' ' '`)
fact('фичи: импорты $app/*', appImp === 'n/a' || appImp === '' ? 'нет' : appImp)
const mr = sh(`grep -rln "MinimalRouter" src/features 2>/dev/null | tr '\\n' ' '`)
fact('фичи: ручной MinimalRouter', mr === 'n/a' || mr === '' ? 'нет' : mr)
fact('фичи: ручной разбор поиска (searchParams.get)', sh(`grep -rc "searchParams.get(" src/features 2>/dev/null | awk -F: '{s+=$2} END {print s+0}'`))
const wl = sh(`grep -c "window\\.location\\.\\|history\\.\\(push\\|replace\\)State" src/lib/paginate/svelte/PaginatorHost.svelte 2>/dev/null`)
fact('хост: window.location.* | history.push/replaceState', wl === 'n/a' ? 0 : wl)
fact('хост: роутер слоя фреймворка (svelteKitRouter)', sh(`grep -c "svelteKitRouter" src/lib/paginate/svelte/PaginatorHost.svelte 2>/dev/null`) || '0')

// ── 4. Гигиена и API ─────────────────────────────────────────────────────────
fact('коммит: PNG-файлов / байт добавлено веткой', (() => {
  const files = sh(`git diff --name-only --diff-filter=A 8bc00e8..${BRANCH} -- '*.png'`).split('\n').filter(Boolean)
  if (!files.length) return '0 файлов'
  const bytes = files.reduce((acc, f) => {
    const [meta] = sh(`git ls-tree -l ${BRANCH} -- "${f}"`).split('\n')
    return acc + Number(meta?.trim().split(/\s+/)[3] ?? 0)
  }, 0)
  return `${files.length} файлов, ${(bytes / 1048576).toFixed(2)} МБ`
})())
const addedBatch = sh(`git diff --numstat 8bc00e8..${BRANCH} -- test/browser/paginate.mjs | awk '{print $1}'`)
fact('новые проверки в test/browser/paginate.mjs (+строк)', addedBatch || '0')
fact('новых автономных проб добавлено веткой (probes/)', sh(`git diff --name-only --diff-filter=A 8bc00e8..${BRANCH} -- probes | wc -l`) || '0')
fact('PaginatorHost: проп router?:', /router\?:/.test(rd('src/lib/paginate/svelte/PaginatorHost.svelte') ?? '') ? 'есть' : 'убран')
fact('PaginatorHost: проп pendingDelayMs?:', /pendingDelayMs\?:/.test(rd('src/lib/paginate/svelte/PaginatorHost.svelte') ?? '') ? 'добавлен' : 'нет')
fact('README пагинатора изменён', sh(`git diff --name-only 8bc00e8..${BRANCH} -- src/lib/paginate/README.md`) ? 'да' : 'нет')

const w = Math.max(...rows.map(([k]) => k.length))
console.log(`\nветка ${BRANCH} · дерево ${TREE}\n`)
for (const [k, val] of rows) console.log(`${k.padEnd(w)} | ${val}`)
