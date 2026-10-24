/**
 * core-purity — страж независимости ядра от фреймворка.
 *
 * Цель системы: одно ядро, много фреймворков. Такое свойство теряется не
 * одним большим решением, а десятком мелких «тут импортну, тут удобнее» —
 * и обнаруживается через полгода, когда переносить уже поздно.
 *
 * Поэтому граница не декларируется в README, а проверяется:
 *   1. ядро не импортирует НИ ОДИН фреймворк;
 *   2. ядро не импортирует слой фреймворка (зависимость только вниз);
 *   3. обвязки живут в заранее названных местах, а не где придётся.
 */

/** Пакеты, присутствие которых делает файл привязанным к фреймворку. */
export const FRAMEWORK_SPECIFIERS = [
  /^svelte(\/|$)/,
  /^@sveltejs\//,
  /^\$app\//,
  /^\$env\//,
  /^react(-dom)?(\/|$)/,
  /^solid-js(\/|$)/,
  /^vue(\/|$)/,
  /^@angular\//,
  /^preact(\/|$)/,
  /^@ark-ui\//,
  /^@zag-js\//,
]

/**
 * Где фреймворк разрешён. Всё остальное внутри модуля обязано быть чистым.
 * Пути — от корня модуля (src/lib/modals).
 */
export const FRAMEWORK_ZONES = [
  // слой реактивности и разметки
  /^svelte\//,
  /^react\//,
  /^solid\//,
  /^vue\//,
  // ядра среды: имя фреймворка — в имени файла
  /^cores\/[a-z-]+\.ts$/,
  // адаптеры к метафреймворку: имя — в имени папки или файла (`paginate/sveltekit/`,
  // `address/sveltekit.ts`), так же явно, как `cores/<фреймворк>.ts`
  /^sveltekit(\/|\.ts$|\.test\.ts$)/,
]

/**
 * Четыре формы, которые реально встречаются в коде:
 *   • статический `import … from 'x'` / `export … from 'x'` — в том числе
 *     многострочный список (`import {\n a,\n b,\n} from 'x'` — обычное дело);
 *   • побочный `import 'x'`;
 *   • динамический `import('x')` — ленивый вызов фреймворка обходит правило
 *     не хуже статического.
 * Раньше ловились только однострочные формы: перенос строки и `import(…)`
 * проходили мимо, и ядро могло позвать фреймворк незаметно для проверки.
 */
const IMPORT_RE = /(?:^|[\s;{}()])(?:import|export)\s+[\s\S]{0,400}?\bfrom\s*['"]([^'"\n]+)['"]/g
const BARE_IMPORT_RE = /(?:^|[\s;{}()])import\s*['"]([^'"\n]+)['"]/g
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g

/** @param {string} source @returns {string[]} */
export function collectSpecifiers(source) {
  const out = []
  for (const re of [IMPORT_RE, BARE_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(source))) out.push(m[1])
  }
  return out
}

/** @param {string} relPath */
export function isFrameworkZone(relPath) {
  const p = relPath.replace(/\\/g, '/')
  return FRAMEWORK_ZONES.some((z) => z.test(p))
}

/**
 * Проверяет ОДИН файл ядра.
 * @param {string} relPath путь от корня модуля
 * @param {string} source
 * @returns {Array<{spec: string, reason: string}>}
 */
export function checkFile(relPath, source) {
  if (isFrameworkZone(relPath)) return []
  const problems = []

  for (const spec of collectSpecifiers(source)) {
    if (FRAMEWORK_SPECIFIERS.some((re) => re.test(spec))) {
      problems.push({
        spec,
        reason:
          'импорт фреймворка в ядре. Ядро обязано собираться и тестироваться ' +
          'без единого фреймворка — иначе «под любой фреймворк» перестаёт быть правдой.',
      })
      continue
    }
    // зависимость только вниз: ядро не знает о слое фреймворка
    const normalized = spec.replace(/^\.\//, '')
    if (/^(\.\.\/)*(svelte|react|solid|vue)\//.test(normalized)) {
      problems.push({
        spec,
        reason:
          'ядро импортирует слой фреймворка. Зависимость направлена только вниз: ' +
          'слой фреймворка знает о ядре, ядро о нём — нет.',
      })
    }
  }

  return problems
}

/** @returns {string} */
export function formatProblems(relPath, problems, root = 'src/lib/modals') {
  if (!problems.length) return ''
  const out = [`\n[core-purity] ${relPath}`]
  for (const p of problems) {
    out.push(`    импорт: ${p.spec}`)
    out.push(`    ${p.reason}`)
  }
  out.push('')
  out.push('  Куда это переносить:')
  out.push(`    • реактивность и разметка → ${root}/<фреймворк>/`)
  out.push(`    • обвязка среды           → ${root}/cores/<фреймворк>.ts`)
  out.push('  Ядро общается с миром только через свои контракты (ядро, среда, хранилище).\n')
  return out.join('\n')
}

/* ── список ядер, проверяемых боевым прогоном ─────────────────────────── */

/**
 * Модули-ядра, для которых действует правило «без фреймворка — или через
 * свой адаптер». Каждый проверяется так же строго, как modals: импорт
 * фреймворка или слоя фреймворка вне FRAMEWORK_ZONES роняет проверку.
 * Новые ядра добавляются сюда, а не в обход проверки.
 */
export const CORE_MODULES = [
  'src/lib/address',
  'src/lib/modals',
  'src/lib/form',
  'src/lib/paginate', // вместе с search/ и filters/ — части пакета
  'src/lib/cache',
  'src/lib/fetch',
  'src/lib/db', // переносимый: PGlite, Hyperdrive, схема — без SvelteKit
  'src/lib/image', // конвейер кадра и state-коллектор — без фреймворка
  'src/lib/task', // крошечный баррель, но правило одно для всех ядер
]
