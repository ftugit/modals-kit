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
 * Отдельные строки — адаптеры движков (svelte/, react/, solid/). Обещание
 * архитектуры: ядро не знает фреймворка, адаптер тонкий. Рост адаптера
 * означает, что логика утекла из ядра в обвязку — это видно ещё до ревью.
 *
 * Бюджет — не догма, а протокол: расти можно, но сознательно — новой
 * строкой в коммите с причиной. Молчащие +10% вот чего нельзя.
 *
 * Зависимости: рантайм формы не импортирует ни одного пакета. Разрешены
 * только относительные пути, а пакет движка ('svelte', 'react', 'solid-js')
 * — только внутри своей зоны адаптера.
 */
import { gzipSync } from 'node:zlib'

/** Пороги. Текущие значения печатает прогон — см. report(). */
export const BUDGETS = {
  /**
   * Вес чтения: байты исходников рантайма (без тестов и документации).
   * 274 КБ включают подтверждённые фиксы ядра v2 и исправления протокола
   * queue/idempotency/server warnings; gzip-бюджет при этом не повышался.
   */
  raw: 274_000,
  /**
   * Вес доставки: gzip конкатенации тех же файлов.
   * Повышено синхронно с raw по той же причине (адаптеры React/Solid).
   */
  gzip: 68_000,
  /**
   * Адаптеры движков: gzip только своей зоны. Тонкая обвязка обязана
   * оставаться тонкой. Повышено для svelte: JSDoc у BindOptions и submit.
   * react/solid — первые значения после переезда адаптеров в библиотеку.
   */
  adapters: { svelte: 8_800, react: 9_000, solid: 8_100 },
}

/** Рантайм-файл: код на TypeScript или Svelte, но не тест и не документация. */
export const isRuntimeFile = (name) => /\.(ts|svelte)$/.test(name) && !/\.test\./.test(name)

/** Зоны адаптеров: единственные места, где форме известен фреймворк. */
export const ADAPTER_ZONES = ['svelte', 'react', 'solid']

/** Зона адаптера по пути от корня библиотеки; ядро — null. */
export const zoneOf = (relPath) => {
  const top = relPath.replace(/\\/g, '/').split('/')[0]
  return ADAPTER_ZONES.includes(top) ? top : null
}

/** Зона адаптера: единственное место, где форме известен фреймворк. */
export const isAdapterZone = (relPath) => zoneOf(relPath) !== null

/** Пакет движка и зона, где он разрешён. */
const ENGINE_PACKAGES = [
  { zone: 'svelte', re: /^svelte(\/|$)/ },
  { zone: 'react', re: /^react(\/|$)/ },
  { zone: 'solid', re: /^solid-js(\/|$)/ },
]

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
 * пакет движка — только в своей зоне адаптера. Всё остальное — нарушение.
 *
 * @param {string} relPath путь от корня библиотеки
 * @param {string[]} specs
 * @returns {Array<{spec: string, reason: string}>}
 */
export function checkImports(relPath, specs) {
  const zone = zoneOf(relPath)
  const problems = []
  for (const spec of specs) {
    if (spec.startsWith('.') || spec.startsWith('/')) continue
    const engine = ENGINE_PACKAGES.find((p) => p.re.test(spec))
    if (engine) {
      if (engine.zone === zone) continue
      problems.push({
        spec,
        reason: `'${spec}' вне зоны ${engine.zone}/: ядро формы обязано собираться `
          + 'без фреймворка — иначе «одно ядро, много фреймворков» перестаёт быть правдой.',
      })
      continue
    }
    problems.push({
      spec,
      reason: 'внешний пакет в рантайме формы. Библиотека не тянет зависимостей: '
        + 'всё, что нужно, либо уже есть в ядре, либо принадлежит приложению.',
    })
  }
  return problems
}

/**
 * @param {Array<{path: string, source: string}>} files пути — от корня библиотеки
 */
export function measure(files) {
  const parts = { core: [] }
  for (const z of ADAPTER_ZONES) parts[z] = []
  for (const f of files) parts[zoneOf(f.path) ?? 'core'].push(f.source)

  // пустой набор весит ноль, а не 20 байт gzip-заголовка пустого потока
  const gz = (list) => (list.length ? gzipSync(Buffer.from(list.join('\n'), 'utf8')).length : 0)
  const raw = (list) => Buffer.byteLength(list.join('\n'), 'utf8')

  const heaviest = [...files]
    .map((f) => ({ path: f.path, raw: Buffer.byteLength(f.source, 'utf8') }))
    .sort((a, b) => b.raw - a.raw)

  const adapters = {}
  for (const z of ADAPTER_ZONES) adapters[z] = { raw: raw(parts[z]), gzip: gz(parts[z]) }
  return {
    files: files.length,
    raw: Object.values(parts).reduce((acc, list) => acc + raw(list), 0),
    gzip: gz(Object.values(parts).flat()),
    coreRaw: raw(parts.core),
    coreGzip: gz(parts.core),
    adapters,
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
  const problems = [
    ...over(m.raw, budgets.raw, 'вес чтения (raw)',
      'Библиотека выросла. Если рост осознанный — подними BUDGETS.raw '
      + 'в tooling/form-size.mjs отдельным коммитом и назови причину. '
      + 'Если нет — самое тяжёлое смотри в отчёте ниже.'),
    ...over(m.gzip, budgets.gzip, 'вес доставки (gzip)',
      'Прокси веса в браузере вырос. Тот же протокол: причина — или худеть.'),
  ]
  for (const z of ADAPTER_ZONES) {
    problems.push(...over(m.adapters[z].gzip, budgets.adapters[z], `адаптер ${z} (gzip)`,
      'Обвязка растёт быстрее ядра: логика утекает из ядра в слой фреймворка. '
      + `Верни её в src/lib/form/*.ts — переносимой для всех обвязок, а ${z}-слой оставь тонким.`))
  }
  return problems
}

/** Человекочитаемый отчёт: цифры сегодня и пороги. */
export function report(m, budgets = BUDGETS) {
  const kb = (n) => `${(n / 1024).toFixed(1)} КБ`
  const lines = [
    `[form-size] файлов: ${m.files}`,
    `  ядро:      ${kb(m.coreRaw)} raw · ${kb(m.coreGzip)} gzip`,
    ...ADAPTER_ZONES.map((z) =>
      `  адаптер ${z.padEnd(6)} ${kb(m.adapters[z].raw)} raw · ${kb(m.adapters[z].gzip)} gzip · бюджет ${kb(budgets.adapters[z])}`),
    `  итого:     ${kb(m.raw)} raw · ${kb(m.gzip)} gzip`,
    `  бюджеты:   ${kb(budgets.raw)} raw · ${kb(budgets.gzip)} gzip`,
    '  самое тяжёлое:',
    ...m.heaviest.slice(0, 5).map((f) => `    ${kb(f.raw).padStart(9)}  ${f.path}`),
  ]
  return lines.join('\n')
}
