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
]

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s*['"]([^'"]+)['"]/g
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g

/** @param {string} source @returns {string[]} */
export function collectSpecifiers(source) {
  const out = []
  for (const re of [IMPORT_RE, BARE_IMPORT_RE]) {
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
export function formatProblems(relPath, problems) {
  if (!problems.length) return ''
  const out = [`\n[core-purity] ${relPath}`]
  for (const p of problems) {
    out.push(`    импорт: ${p.spec}`)
    out.push(`    ${p.reason}`)
  }
  out.push('')
  out.push('  Куда это переносить:')
  out.push('    • реактивность и разметка → src/lib/modals/<фреймворк>/')
  out.push('    • обвязка роутера         → src/lib/modals/adapters/<фреймворк>.ts')
  out.push('  Ядро общается с миром только через ChainAdapter.\n')
  return out.join('\n')
}
