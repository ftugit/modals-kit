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
 * Отдельные строки — адаптеры движков (сейчас один: svelte/). Обещание
 * архитектуры: ядро не знает фреймворка, адаптер тонкий. Рост адаптера
 * означает, что логика утекла из ядра в обвязку — это видно ещё до ревью.
 *
 * Бюджет — не догма, а протокол: расти можно, но сознательно — новой
 * строкой в коммите с причиной. Молчащие +10% вот чего нельзя.
 *
 * Зависимости: рантайм формы не импортирует ни одного пакета. Разрешены
 * только относительные пути, а пакет движка ('svelte' — у будущих адаптеров свой)
 * — только внутри своей зоны адаптера. Единственное исключение — `esm-env`
 * (см. ALLOWED_PACKAGES).
 */
import { gzipSync } from 'node:zlib'

/** Пороги. Текущие значения печатает прогон — см. report(). */
export const BUDGETS = {
  /**
   * Вес чтения: байты исходников рантайма (без тестов и документации).
   * Поднят до фактических 307 682 + запас по решению оператора 2026-10-10.
   * Причины роста: компонент Form (formProps + hidden-пары — тег формы и
   * служебные поля больше не собираются потребителями вручную), скоупинг
   * настроек (hostConfigBy/configureBase) и контракт FieldComponent.
   * Поднят до 328 000 (факт 321 348) по решению оператора 2026-10-11, ход 10:
   * F19 бронь идемпотентности reserve/release (+5,0 К), F18 обязательный ключ
   * частоты и чистка окон (+1,6 К), F23 тексты 13 кодов ошибок (+1,5 К),
   * F16 поднятие source до слоя имён (+1,2 К). 7,7 К из них — server.ts.
   */
  raw: 328_000,
  /**
   * Вес доставки: gzip конкатенации тех же файлов. Повышено синхронно с raw
   * по той же причине (факт 82 598, операторское решение 2026-10-10).
   * Поднят до 89 000 (факт 87 157) синхронно с raw, оператор 2026-10-11, ход 10.
   * (Ход 171 поднимал до 90 500 под `standard.ts`; ход 185 его удалил — лимит вернулся.)
   * 89 000 → 89 700 (ход 189, решение «≤ +5 КБ, сообщить»): ход отправки от транспорта
   * (`TransportRequest.report` → `FormState.progress` → `formTask`), факт 89 472.
   * 89 700 → 94 000 (ход 224, то же решение): `kit.ts` — набор полей от пользователя
   * (`defineFieldKit`: каталог видов, схема валидаторов с пределами), факт 93 645. Пока его
   * не импортирует ни одна страница, в бандл он не попадает; с `/fields` он едет в общий
   * чанк формы (+1.5 КБ маршрутам, см. tooling/size-budget.mjs, ход 224).
   * 94 000 → 94 200 (ход 224): файл не возвращается в `Result.values` (`stripSecret`), факт 94 019.
   */
  gzip: 94_200,
  /**
   * Адаптеры движков: gzip только своей зоны. Тонкая обвязка обязана
   * оставаться тонкой — но провайдер поля (bind + Form-обвязка) реально
   * весит, поэтому поднят до фактов с запасом (оператор, 2026-10-10):
   * svelte 12 472. Зоны react/solid удалены вместе с адаптерами (C9, ход 25):
   * новый адаптер приходит со своей зоной, пакетом движка и бюджетом.
   * 13 000 → 13 500 (ход 112): закреплённые серверные ошибки — логика в ядре
   * (`pins.ts`), в обвязке только связка с вводом и состоянием: 12 983 → 13 335.
   * 13 500 → 13 650 (ход 185, постоянное решение «≤ +5 КБ, сообщить»): подсказка сервера
   * к полю (`note`/`noteProps` вида поля и её id в `aria-describedby`), факт 13 530;
   * логики нет, только отображение `Result.notes` на поле, как у `errors`.
   * 13 650 → 14 000 (ход 189, то же решение): `svelte/task.ts` — отправка в формате задачи
   * для кнопки и глобального лоадера (src/lib/task/README.md), факт 13 850;
   * отдельный файл считается своим gzip — из ~320 байт половина его заголовок и описание.
   * 14 000 → 14 400 (ход 189, то же решение): ход отправки — `bind` пишет `progress` живой
   * отправки, `formTask` отдаёт его как задачу (шаг 9), факт 14 263.
   */
  adapters: { svelte: 14_400 },
}

/** Рантайм-файл: код на TypeScript или Svelte, но не тест и не документация. */
export const isRuntimeFile = (name) => /\.(ts|svelte)$/.test(name) && !/\.test\./.test(name)

/** Зоны адаптеров: единственные места, где форме известен фреймворк. */
export const ADAPTER_ZONES = ['svelte']

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
 * Пакеты, разрешённые во всём рантайме формы. Только `esm-env`: флаг режима
 * разработки по условиям экспорта (`development`/`production`) — работает в любом
 * сборщике и в Node SSR без Vite, в отличие от `import.meta.env.DEV`, который
 * подставляет только Vite (решение C7, ход 10). Кода в сборке он не оставляет:
 * `DEV` — константа, ветки вырезаются; и он уже стоит у Svelte в зависимостях.
 * Добавлять сюда что-то ещё — только с причиной такого же веса.
 */
export const ALLOWED_PACKAGES = Object.freeze(['esm-env'])

/**
 * Внешние зависимости рантайма. Разрешены относительные пути всегда,
 * пакет движка — только в своей зоне адаптера, `ALLOWED_PACKAGES` — везде.
 * Всё остальное — нарушение.
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
    if (ALLOWED_PACKAGES.includes(spec)) continue
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
