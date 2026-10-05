/**
 * form-size — страж веса библиотеки форм.
 *
 * Библиотека приезжает в приложение исходниками и собирается вместе с ним,
 * поэтому бюджет назначается исходникам, а не сборке. Две меры ловят разное:
 *
 *   raw   — «вес чтения»: сколько байтов обязан прочитать тот, кто правит
 *           библиотеку. Комментарии здесь считаются: это документация.
 *   gzip  — «вес доставки»: прокси того, что уедет в браузер. Настоящие
 *           цифры знает только сборка приложения; прокси нужен, чтобы
 *           замечать рост без сборки.
 *
 * Отдельная строка — адаптер Svelte. Обещание архитектуры: ядро не знает
 * фреймворка, адапвер тонкий. Рост адаптера означает, что логика утекла
 * из ядра в обвязку — это видно ещё до ревью.
 *
 * Бюджет — не догма, а протокол: расти можно, но сознательно — новой
 * строкой в коммите с причиной. Молчащие +10% вот чего нельзя.
 *
 * Зависимости: рантайм формы не импортирует ни одного пакета. Разрешены
 * только относительные пути, а 'svelte' — только внутри svelte/.
 */
import { gzipSync } from 'node:zlib'

/** Пороги. Текущие значения печатает прогон — см. report(). */
export const BUDGETS = {
  /** Вес чтения: байты исходников рантайма (без тестов и документации). */
  raw: 180_000,
  /** Вес доставки: gzip конкатенации тех же файлов. */
  gzip: 52_000,
  /** Адаптер Svelte: gzip только svelte/. Тонкая обвязка обязана оставаться тонкой. */
  adapterGzip: 8_200,
}

/** Рантайм-файл: код на TypeScript или Svelte, но не тест и не документация. */
export const isRuntimeFile = (name) => /\.(ts|svelte)$/.test(name) && !/\.test\./.test(name)

/** Зона адаптера: единственное место, где форме известен фреймворк. */
export const isAdapterZone = (relPath) => relPath.replace(/\\/g, '/').startsWith('svelte/')

/**
 * @param {string} source
 * @returns {string[]} спецификаторы всех статических импортов и реэкспортов
 */
export function collectSpecifiers(source) {
  const out = []
  for (const re of [/(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s*['"]([^'"]+)['"]/g,
                    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(source))) out.push(m[1])
  }
  return out
}

/**
 * Внешние зависимости рантайма. Разрешены относительные пути всегда,
 * 'svelte' — только в зоне адаптера. Всё остальное — нарушение.
 *
 * @param {string} relPath путь от корня библиотеки
 * @param {string[]} specs
 * @returns {Array<{spec: string, reason: string}>}
 */
export function checkImports(relPath, specs) {
  const problems = []
  for (const spec of specs) {
    if (spec.startsWith('.') || spec.startsWith('/')) continue
    const isSvelte = /^svelte(\/|$)/.test(spec)
    if (isSvelte && isAdapterZone(relPath)) continue
    problems.push({
      spec,
      reason: isSvelte
        ? "'svelte' вне svelte/: ядро формы обязано собираться без фреймворка — "
          + 'иначе «одно ядро, много фреймворков» перестаёт быть правдой.'
        : 'внешний пакет в рантайме формы. Библиотека не тянет зависимостей: '
          + 'всё, что нужно, либо уже есть в ядре, либо принадлежит приложению.',
    })
  }
  return problems
}

/**
 * @param {Array<{path: string, source: string}>} files пути — от корня библиотеки
 */
export function measure(files) {
  const byZone = (f) => (isAdapterZone(f.path) ? 'adapter' : 'core')
  const parts = { core: [], adapter: [] }
  for (const f of files) parts[byZone(f)].push(f.source)

  // пустой набор весит ноль, а не 20 байт gzip-заголовка пустого потока
  const gz = (list) => (list.length ? gzipSync(Buffer.from(list.join('\n'), 'utf8')).length : 0)
  const raw = (list) => Buffer.byteLength(list.join('\n'), 'utf8')

  const heaviest = [...files]
    .map((f) => ({ path: f.path, raw: Buffer.byteLength(f.source, 'utf8') }))
    .sort((a, b) => b.raw - a.raw)

  return {
    files: files.length,
    raw: raw(parts.core) + raw(parts.adapter),
    gzip: gz(parts.core.concat(parts.adapter)),
    coreRaw: raw(parts.core),
    coreGzip: gz(parts.core),
    adapterRaw: raw(parts.adapter),
    adapterGzip: gz(parts.adapter),
    heaviest,
  }
}

/**
 * @param {ReturnType<typeof measure>} m
 * @param {typeof BUDGETS} [budgets]
 * @returns {Array<{line: string, why: string}>}
 */
export function checkBudgets(m, budgets = BUDGETS) {
  const over = (got, max, line, why) =>
    got > max ? [{ line: `${line}: ${got} > ${max}`, why }] : []
  return [
    ...over(m.raw, budgets.raw, 'вес чтения (raw)',
      'Библиотека выросла. Если рост осознанный — подними BUDGETS.raw '
      + 'в tooling/form-size.mjs отдельным коммитом и назови причину. '
      + 'Если нет — самое тяжёлое смотри в отчёте ниже.'),
    ...over(m.gzip, budgets.gzip, 'вес доставки (gzip)',
      'Прокси веса в браузере вырос. Тот же протокол: причина — или худеть.'),
    ...over(m.adapterGzip, budgets.adapterGzip, 'адаптер svelte (gzip)',
      'Обвязка растёт быстрее ядра: логика утекает из ядра в слой фреймворка. '
      + 'Верни её в src/lib/form/*.ts — переносимой для всех обвязок.'),
  ]
}

/** Человекочитаемый отчёт: цифры сегодня и пороги. */
export function report(m, budgets = BUDGETS) {
  const kb = (n) => `${(n / 1024).toFixed(1)} КБ`
  const lines = [
    `[form-size] файлов: ${m.files}`,
    `  ядро:      ${kb(m.coreRaw)} raw · ${kb(m.coreGzip)} gzip`,
    `  адаптер:   ${kb(m.adapterRaw)} raw · ${kb(m.adapterGzip)} gzip`,
    `  итого:     ${kb(m.raw)} raw · ${kb(m.gzip)} gzip`,
    `  бюджеты:   ${kb(budgets.raw)} raw · ${kb(budgets.gzip)} gzip · адаптер ${kb(budgets.adapterGzip)} gzip`,
    '  самое тяжёлое:',
    ...m.heaviest.slice(0, 5).map((f) => `    ${kb(f.raw).padStart(9)}  ${f.path}`),
  ]
  return lines.join('\n')
}
