/**
 * probe: аудит классов — «классов больше нет, а утилиты все на месте».
 *
 * Обходит область рефактора (или переданные файлы, или `--all`), собирает
 * класс-токены и спрашивает у настоящего UnoCSS (presetWind4 с темой
 * проекта), что из них НЕ сгенерировалось. Заодно проверяет второе
 * требование: собственных классов-маркеров (`modal-*`, `select-*`,
 * `floating-menu`, `field-*`…) в исходниках быть не должно — снаружи система
 * видна только по data-атрибутам и id.
 *
 * Класс-токены берутся ТОЛЬКО из мест, где классы и живут:
 *   • значения `class="…"` и `class={…}` в разметке — включая содержимое
 *     скобок (`class={cn('a', cond && 'b')}` — это классы);
 *   • строковые литералы внутри `<script>` (там лежат константы вроде
 *     `const BTN = '…'` и CVA-наборы);
 *   • все литералы .ts-модулей (classes.ts, variants.ts — там только классы).
 * Значения `id`, `name`, `data-testid`, `autocomplete` и прочих атрибутов
 * поэтому в отчёт не попадают: они и должны быть словами.
 *
 *   node tooling/classes-audit.mjs              # область рефактора
 *   node tooling/classes-audit.mjs --all        # весь src (шумно, для осмотра)
 *   node tooling/classes-audit.mjs src/app.html # конкретные файлы
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createGenerator } from '@unocss/core'
import { runnerImport } from 'vite'

const { module: unoConfig } = await runnerImport(fileURLToPath(new URL('../unocss.config.ts', import.meta.url)))
const uno = await createGenerator({ ...unoConfig.default, safelist: [] })

/** Обход src: файлы, где вообще бывают классы. */
function walk(dir = 'src') {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = `${dir}/${name}`
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (/\.(svelte|ts|html)$/.test(name)) out.push(path)
  }
  return out
}

/**
 * Область рефактора: модальная система, Select, drawer, базовые поля и
 * демо-страницы. Остальной src (`lib/form`, `lib/paginate`, шапка) живёт
 * по своим правилам и в аудит не входит.
 */
const SCOPE = [
  'src/app.html',
  'src/lib/modals/svelte/classes.ts',
  'src/lib/modals/svelte/ModalHost.svelte',
  'src/lib/modals/svelte/Layers.svelte',
  'src/lib/modals/svelte/Tails.svelte',
  'src/lib/modals/svelte/ModalContent.svelte',
  'src/lib/components/shell/AppShell.svelte',
  'src/lib/components/modals/variants.ts',
  'src/lib/components/modals/index.ts',
  'src/lib/components/modals/Skeleton.svelte',
  'src/lib/components/modals/ModalError.svelte',
  'src/lib/components/modals/CloseAllButton.svelte',
  'src/lib/components/modals/ForceClose.svelte',
  'src/lib/components/ui/field/field.ts',
  'src/lib/components/ui/checkbox/Checkbox.svelte',
  'src/lib/components/ui/switch/Switch.svelte',
  'src/lib/components/ui/radio-group/RadioItem.svelte',
  'src/lib/components/ui/radio-group/RadioGroup.svelte',
  'src/lib/components/ui/range/Range.svelte',
  'src/lib/components/ui/attachment/Attachment.svelte',
  'src/lib/components/ui/attachment/AttachmentAction.svelte',
  'src/lib/components/ui/attachment/variants.ts',
  'src/lib/components/ui/skeleton/Skeleton.svelte',
  'src/lib/components/paginator/Paginator.svelte',
  'src/lib/components/paginator/variants.ts',
  'src/lib/components/paginator/ui/Skeleton.svelte',
  'src/lib/components/paginator/ui/SearchBar.svelte',
  'src/lib/components/fields/SchemaBuilder.svelte',
  'src/lib/components/fields/SchemaFields.svelte',
  'src/lib/components/fields/SchemaValues.svelte',
  'src/lib/components/fields/variants.ts',
  'src/lib/components/ui/select/Select.svelte',
  'src/lib/components/ui/select/SelectList.svelte',
  'src/lib/components/ui/input/AffixSwap.svelte',
  'src/lib/components/ui/otp-input/OtpInput.svelte',
  'src/lib/components/ui/password/PasswordStrength.svelte',
  'src/lib/components/ui/phone-input/PhoneInput.svelte',
  'src/lib/components/ui/textarea/Textarea.svelte',
  'src/lib/components/ui/textarea/AutoTextarea.svelte',
  'src/lib/components/ui/search/SearchInput.svelte',
  'src/lib/components/ui/search/SearchField.svelte',
  'src/lib/components/ui/number-field/NumberField.svelte',
  'src/lib/components/ui/password/PasswordInput.svelte',
  'src/lib/components/ui/copy-input/CopyInput.svelte',
  'src/routes/(site)/(modals-demo)/FloatingMenu.svelte',
  'src/routes/(site)/(modals-demo)/modals/SourcesPanel.svelte',
  'src/routes/(site)/(modals-demo)/SelectModal.svelte',
  'src/routes/(site)/(modals-demo)/FlowProbeModal.svelte',
  'src/routes/cycle/+page.svelte',
  'src/routes/spike/+page.svelte',
  'src/routes/(site)/(app)/+page.svelte',
  // Шапка и сайдбар: своих классов там тоже не осталось (единственный
  // признак активного пункта — `aria-current="page"`).
  'src/lib/components/header/NavSlot.svelte',
  'src/lib/components/header/LogoSlot.svelte',
  'src/lib/components/header/PageTitleSlot.svelte',
  'src/lib/components/header/ThemeToggleSlot.svelte',
  'src/lib/components/header/SiteFooter.svelte',
  'src/lib/components/sidebar/SidebarNav.svelte',
  'src/lib/components/sidebar/SidebarFooter.svelte',
  'src/lib/components/sidebar/SidebarUser.svelte',
]

const args = process.argv.slice(2)
const targets = args.includes('--all')
  ? walk()
  : args.length
    ? args.filter((a) => a !== '--all')
    : SCOPE

const strip = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
    .replace(/<!--[\s\S]*?-->/g, '')

/** Вырезать сбалансированный {...} начиная с открывающей скобки. */
function braceAt(src, open) {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  return src.slice(open + 1)
}

/** Кусок разметки, где лежат классы: class="…" и class={…}. */
function classChunks(src) {
  const chunks = []
  for (const m of src.matchAll(/class\s*=\s*("([^"]*)"|\{)/g)) {
    if (m[2] !== undefined) chunks.push(m[2])
    else {
      const open = m.index + m[0].length - 1
      chunks.push(braceAt(src, open))
    }
  }
  return chunks
}

/** Строковые литералы: '…', "…", `…` (${…} выкидываем — это код). */
function literals(src) {
  const out = []
  for (const m of src.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '')
  }
  return out
}

/**
 * Токены-классы.
 *
 * Отсеиваем то, что классом быть не может, иначе отчёт тонет в словах:
 *   • чистые строчные слова (`top`, `left`, `default`);
 *   • слова с капиталом, точкой, слэшем, `=`, кавычками — это код;
 *   • фрагменты медиазапросов, CSS-переменные, имена атрибутов;
 *   • `${…}`-подстановки в шаблонах.
 */
function tokensFrom(chunks) {
  const out = new Set()
  // В `class={…}` попали и комментарии прямо внутри вызова `cn(…)` — их тоже
  // выкидываем, иначе в отчёт лезут слова из прозы.
  for (const raw of chunks.map((c) => c.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/[^\n]*/g, '$1'))) {
    for (const tok of raw.split(/\s+/)) {
      if (!tok || tok.length < 3 || tok.includes('${')) continue
      if (/^[a-z]+$/.test(tok)) continue
      if (/[A-Z.\/=<>;,"'@#]/.test(tok)) continue
      if (!/^[-a-z0-9[\]:%_!()]+$/.test(tok)) continue
      if (/^-?\d/.test(tok)) continue
      if (/^(--|(?:aria|data)-[a-z-]+$|\[data-|cn\(|bind:|display:|animation)/.test(tok)) continue
      if (/^[a-z-]+:$/.test(tok)) continue
      if (/^(fade|scale|slide-up|slide-down|slide|blur)$/.test(tok)) continue
      if (tok.startsWith('(') || /\)$/.test(tok)) continue
      // Имена групп Uno (`group/sheet`, `group/morph`) — не классы с CSS.
      if (/^group\/[a-z]+$/.test(tok)) continue
      out.add(tok)
    }
  }
  return out
}

function tokensOf(file) {
  const raw = readFileSync(file, 'utf8')
  const isMarkup = /\.(svelte|html)$/.test(file)
  if (!isMarkup) return tokensFrom(literals(strip(raw)))
  const chunks = classChunks(raw)
  for (const m of raw.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    const cleaned = strip(m[1]).replace(
      /\b(?:live|submitTestId|lockStateKey|formId|id|name|owner|key|mode|storageKey)\s*[:=]\s*(['"`])[^'"`]*\1/g,
      ' ',
    )
    chunks.push(...literals(cleaned))
  }
  return tokensFrom(chunks)
}

/**
 * Класс-маркер: собственное имя, а не утилита Uno. Таких в области
 * рефактора быть не должно ни одного — их роль играют data-атрибуты.
 */
const MARKER =
  /^(modal-|select-|floating-menu|fe-sidebar|sidebar-|nav-pill|field-|demo-fields|search-|strength|otp|phone-|affix-swap|skeleton$|page-|header-|footer-)/

/**
 * Не классы, хотя и похожи: служебные строки из скриптов, которые попадают
 * в литералы. Список закрытый и осознанный — если здесь появится новое
 * слово, оно должно быть осознанно добавлено, а не «просто чтобы прошло».
 */
const NOT_A_CLASS = new Set([
  'fe-theme', // ключ localStorage выбранной темы
  'field-sizing', // свойство CSS в CSS.supports('field-sizing', 'content')
  'z-index', // свойство CSS в объектах style хостa
  'max-height', // то же
  'outside-pointer', // причина закрытия оверлея (HostFloatingCloseReason)
  'modals:chain', // ключ localStorage у демо-панели источников
  'sci-fi', // значение опции демо-селекта
  'flow-probe', // имя зарегистрированной модалки
  'modals-host', // id диалога Ark у хоста
  'modals-host-sheet',
  '[tabindex]', // фрагмент селектора в querySelector хоста
  '[modals]',
  'esm-env',
  'owner-closed',
  'sveltekit:history',
  '!checked', // выражение кода внутри class={cn(…)}
  'cn(', // вызов cn из того же class={cn(…)}
])

const wanted = new Set()
const perFile = new Map()
for (const file of targets) {
  if (!existsSync(file)) continue // дерево может не содержать файл из общего списка
  const toks = tokensOf(file)
  perFile.set(file, [...toks])
  for (const t of toks) wanted.add(t)
}

const list = [...wanted]
const out = await uno.generate(list.join(' '), { preflights: false })
const missing = list.filter((t) => !out.matched.has(t) && !NOT_A_CLASS.has(t))
const markers = missing.filter((t) => MARKER.test(t))
const broken = missing.filter((t) => !MARKER.test(t))
const where = (tok) => [...perFile].filter(([, toks]) => toks.includes(tok)).map(([f]) => f).join(', ')

console.log(`Файлов: ${targets.length}, токенов: ${list.length}`)
console.log(`Маркер-классов (должно быть 0): ${markers.length}`)
if (markers.length) {
  console.log('\nМаркеры вернулись — их не должно быть вовсе:')
  for (const m of markers) console.log(`  • ${m}  ←  ${where(m)}`)
}
if (broken.length) {
  console.log('\nНЕ сгенерировано, и это не маркер — проверить руками:')
  for (const m of broken) console.log(`  • ${m}  ←  ${where(m)}`)
} else {
  console.log('Все утилиты сгенерированы.')
}
if (markers.length || broken.length) process.exitCode = 1
