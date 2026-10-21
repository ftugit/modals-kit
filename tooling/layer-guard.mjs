/**
 * layer-guard — запрет импортов и нативных тегов на уровне СБОРКИ, а не линтера.
 *
 * Зачем: соглашение, которое живёт только в документации или в eslint,
 * не соблюдается тем, кто о нём не знает (в том числе ИИ, дописывающим код).
 * Плагин Vite роняет и `dev`, и `build` на запрещённом импорте — обойти,
 * не заметив, невозможно, а сообщение объясняет, что делать вместо.
 */

/**
 * Нормализация пути: разделители и обрезка query/hash Vite.
 * @param {string | undefined | null} p
 * @returns {string}
 */
function norm(p) {
  if (!p) return '';
  return p.replace(/\\/g, '/').split('?')[0];
}

/**
 * @param {RegExp | string} pattern
 * @param {string} value
 */
function matchPattern(pattern, value) {
  return pattern instanceof RegExp ? pattern.test(value) : value === pattern;
}

/**
 * Канонический вид спецификатора: `#lib/`, `$lib/` и относительные пути —
 * к пути от корня проекта (`src/lib/...`). Импортное правило обязано
 * ловить запрет по СМЫСЛУ пути, а не по написанию: правило, смотревшее
 * только на `#lib/...`, пропускало тот же импорт через `$lib/` и через
 * `../components/...` (дыра вскрыта вопросом владельца о защите lib/form,
 * 2026-10-21). Внешние пакеты и непути канона не имеют — null.
 * @param {string} source сырой спецификатор, как написан
 * @param {string} importer нормализованный путь импортёра
 * @returns {string | null}
 */
function canonSpecifier(source, importer) {
  if (source.startsWith('#lib/')) return 'src/lib/' + source.slice(5);
  if (source.startsWith('$lib/')) return 'src/lib/' + source.slice(5);
  if (source.startsWith('./') || source.startsWith('../')) {
    const dir = importer.split('/').slice(0, -1);
    for (const part of source.split('/')) {
      if (part === '..') dir.pop();
      else if (part !== '.' && part !== '') dir.push(part);
    }
    const joined = dir.join('/');
    const at = joined.indexOf('src/');
    return at >= 0 ? joined.slice(at) : null;
  }
  return null;
}

/**
 * @typedef {object} Rule
 * @property {RegExp | string} pattern
 * @property {boolean} [isTemplateCheck] правило по разметке (.svelte/.html)
 * @property {boolean} [isSourceCheck] правило по ЛЮБОМУ исходнику: .ts/.js тоже,
 *   иначе обход прячется в скрипте (`document.createElement('form')`, ручные
 *   `formProps`) — там, где разметочные правила не действуют.
 * @property {(RegExp | string)[]} [allow]
 * @property {(RegExp | string)[]} [deny]
 * @property {(RegExp | string)[]} [scope] правило действует ТОЛЬКО в этих файлах
 *   (для запретов, адресованных библиотеке, а не приложению)
 * @property {RegExp} [require] срабатывает ТОЛЬКО если в тексте нет этого узора:
 *   способ потребовать «пользуйся библиотекой», не запрещая сам приём.
 * @property {string | ((ctx: {source: string, importer: string, rule: Rule}) => string)} message
 */

/**
 * Общий проход по правилам: одно совпадение узора + файл вне allow-списка +
 * (если задан `require`) отсутствие обязательного узора = ошибка.
 * @param {Rule[]} rules
 * @param {string} code
 * @param {string | undefined} id
 * @returns {string | null}
 */
function runTextRules(rules, code, id) {
  const file = norm(id);
  const src = typeof code === 'string' ? code : String(code ?? '');
  for (const rule of rules) {
    if (!matchPattern(rule.pattern, src)) continue;
    // scope — только исходники проекта: у зависимостей свой путь с `/src/`
    // (`node_modules/@sveltejs/kit/src/...`), чужие правила их не касаются.
    if (rule.scope && (file.includes('/node_modules/') || !rule.scope.some((sc) => matchPattern(sc, file))))
      continue;
    const allowed = (rule.allow ?? []).some((a) => matchPattern(a, file));
    if (allowed) continue;
    if (rule.require && rule.require.test(src)) continue;
    return typeof rule.message === 'function'
      ? rule.message({ source: src, importer: file, rule })
      : rule.message;
  }
  return null;
}

/**
 * Чистое ядро — без Vite, чтобы покрывалось обычным node --test.
 * @param {Rule[]} rules
 * @returns {(source: string, importer?: string) => string | null}
 */
export function createGuard(rules) {
  /**
   * @param {string} source
   * @param {string | undefined} [importer]
   * @returns {string | null}
   */
  return function check(source, importer) {
    const src = norm(source);
    const from = norm(importer);
    // узор сверяется и с написанием, и с каноном: старые правила писаны
    // по написанию (`#lib/...`), новые — по канону (`src/lib/...`) и
    // потому не обходятся сменой алиаса.
    const canon = canonSpecifier(src, from);
    for (const rule of rules) {
      if (rule.isTemplateCheck) continue;
      if (!matchPattern(rule.pattern, src) && !(canon && matchPattern(rule.pattern, canon))) continue;
      // deny сильнее allow: «кому явно нельзя» срабатывает даже для файлов из
      // общего allow-списка потребителей. Так lib/form отсекается от
      // UI-примитивов, оставаясь доступным для всего остального слоя.
      if ((rule.deny ?? []).some((d) => matchPattern(d, from))) {
        return typeof rule.message === 'function'
          ? rule.message({ source: src, importer: from, rule })
          : rule.message;
      }
      const allowed = (rule.allow ?? []).some((/** @type {RegExp|string} */ a) => matchPattern(a, from));
      if (allowed) continue;
      return typeof rule.message === 'function'
        ? rule.message({ source: src, importer: from, rule })
        : rule.message;
    }
    return null;
  };
}

/**
 * Шаблонная часть правил (сырые теги в разметке) — тоже чистая функция,
 * чтобы её тестировали node --test, а не только живая vite-сборка.
 * @param {Rule[]} rules
 * @param {string} code
 * @param {string | undefined} id
 * @returns {string | null}
 */
export function checkTemplate(rules, code, id) {
  return runTextRules(rules.filter((r) => r.isTemplateCheck), code, id);
}

/**
 * Правила по исходнику целиком — действуют и на .ts, и на .js: обход
 * lib/form ровно там и прячется (ручные formProps, createElement, разбор тела).
 * @param {Rule[]} rules
 * @param {string} code
 * @param {string | undefined} id
 * @returns {string | null}
 */
export function checkSource(rules, code, id) {
  return runTextRules(rules.filter((r) => r.isSourceCheck), code, id);
}

/**
 * @param {Rule[]} rules
 * @returns {import('vite').Plugin}
 */
export function layerGuard(rules) {
  const check = createGuard(rules);
  const templateRules = rules.filter((r) => r.isTemplateCheck);
  const sourceRules = rules.filter((r) => r.isSourceCheck);
  return {
    name: 'layer-guard',
    enforce: 'pre',
    /**
     * @param {string} source
     * @param {string | undefined} importer
     */
    resolveId(source, importer) {
      const problem = check(source, importer);
      if (problem) this.error(problem);
      return null;
    },
    /**
     * @param {string} code
     * @param {string} id
     */
    transform(code, id) {
      const file = norm(id);
      if (file.endsWith('.svelte') || file.endsWith('.html')) {
        const msg = checkTemplate(templateRules, code, id);
        if (msg) this.error(msg);
      }
      // Сырые теги ловятся в разметке, а обход — в скриптах: проверки должны
      // покрывать и .ts/.js, иначе «формы только через lib/form» остаётся
      // пунктиром, который обходится одной строкой в модуле.
      if (/\.(?:svelte|ts|js|mjs|cjs)$/.test(file)) {
        const msg = checkSource(sourceRules, code, id);
        if (msg) this.error(msg);
      }
      return null;
    },
  };
}

/* ── правила проекта ───────────────────────────────────────────────── */

const MODALS_LIB = /(^|\/)src\/lib\/modals\//;
/** Единственный владелец записи адреса: писатель, бронь ключей, алгебра GET. */
const ADDRESS_LIB = /(^|\/)src\/lib\/address\//;
/** Навигационные примитивы: их работа — переход, а не правка GET-адреса. */
const NAV_PRIMITIVES = [
  /(^|\/)src\/lib\/components\/links\//,
  /(^|\/)src\/lib\/components\/ui\/button\/HoldButton\.svelte$/,
];
/** Чтение «реальности фреймворка» — обязанность ядра движка модалок. */
const MODALS_ENGINE = /(^|\/)src\/lib\/modals\/cores\//;
/** Правила адреса действуют на ИСХОДНИКИ проекта: node_modules SvelteKit вправе
 *  упоминать page.url в своих рантайм-файлах и сообщениях. */
const SRC_ONLY = [/(^|\/)src\//];
/** Кто имеет право на сырые form-теги и на собственный разбор тела. */
const FORM_KEEPERS = [
  /(^|\/)src\/lib\/form\//,
  /(^|\/)src\/lib\/components\/ui\//,
  /(^|\/)src\/lib\/components\/settings\//,
  /(^|\/)src\/lib\/components\/shell\//,
  /(^|\/)node_modules\//,
  /(^|\/)tooling\//,
];

/** @type {Rule[]} */

export const RULES = [
/* ── адрес: чтение и запись GET — только через #lib/address ──────────
 *
 * Зачем жёстко. Дефект /steps (ход 262): панель писала адрес полным `goto`
 * из-под свежей shallow-записи модального списка; SvelteKit молча отменял
 * навигацию, и режим «не переключался» — на десктопе работало, на таче нет.
 * Класс дефекта — не «одна опечатка», а второй писатель адреса: своя очередь
 * истории, которая обгоняет чужую и теряет чужие ключи/состояние.
 * Соглашение в документации этот класс не держит — держит отказ сборки.
 */
{
  pattern: /\bhistory\s*\.\s*(?:pushState|replaceState)\s*\(/,
  isSourceCheck: true,
  scope: SRC_ONLY,
  allow: [ADDRESS_LIB],
  message: ({ importer }) =>
    [
      '[layer-guard] Прямой history.pushState/replaceState запрещён.',
      `  файл: ${importer || '<точка входа>'}`,
      '',
      '  Адрес страницы пишет ТОЛЬКО общий писатель:',
      '',
      "      import { writeAddress } from '#lib/address/sveltekit.js';",
      "      void writeAddress(() => ({ url: '/page?key=value' }), { replace: false, load: false });",
      '',
      '  Почему: нативный history SvelteKit не видит и перетирает;',
      '  своя запись = вторая очередь истории, которая обгоняет записи',
      '  модалок/пагинатора и теряет их ключи и состояние (F41).',
    ].join('\n'),
},
{
  pattern: /import\s*\{[\s\S]*?\b(?:pushState|replaceState)\b[\s\S]*?\}\s*from\s*['"]\$app\/navigation['"]/,
  isSourceCheck: true,
  scope: SRC_ONLY,
  allow: [ADDRESS_LIB],
  message: ({ importer }) =>
    [
      '[layer-guard] pushState/replaceState из $app/navigation запрещены.',
      `  файл: ${importer || '<точка входа>'}`,
      '',
      '  Это запись адреса — её делает общий писатель:',
      '',
      "      import { writeAddress } from '#lib/address/sveltekit.js';",
      "      void writeAddress(() => ({ url, state }), { replace: true, load: false });",
      '',
      '  Почему: именно полная/своя запись из-под shallow-слоя сломала',
      '  /steps на таче — SvelteKit отменил навигацию, и режим демо',
      '  не переключался. Писатель сериализует записи и знает про слои.',
      "  Свои ключи бронируйте: claimQuery(owner, 'ключ', 'ключ.*').",
    ].join('\n'),
},
{
  pattern: /\bpage\s*\.\s*url\b/,
  isSourceCheck: true,
  scope: SRC_ONLY,
  // `/spike` — диагностическая страница, её работа — ПОКАЗАТЬ разницу между
  // адресом отрисовки и видимым адресом.
  allow: [ADDRESS_LIB, MODALS_ENGINE, /(^|\/)src\/routes\/spike\//],
  message: ({ importer }) =>
    [
      '[layer-guard] Чтение `page.url` запрещено.',
      `  файл: ${importer || '<точка входа>'}`,
      '',
      '  Читайте видимый адрес — с учётом мелких записей и намерения:',
      '',
      "      import { visibleAddress } from '#lib/address/sveltekit.js';",
      '      const here = visibleAddress().url;   // pathname + search',
      '',
      '  Почему: после мелкой записи (модалка, панель, шаг) `page.url`',
      '  описывает ОТРИСОВАННУЮ страницу, а не видимый адрес. Ссылка,',
      '  собранная из него, возвращает старые ключи и теряет новые —',
      '  это второй дефект /steps (ход 262). Чужие ключи читать можно:',
      '  readQuery/visibleAddress отдают весь адрес, бронь касается записи.',
    ].join('\n'),
},
{
  pattern: /import\s*\{[\s\S]*?\bgoto\b[\s\S]*?\}\s*from\s*['"]\$app\/navigation['"]/,
  isSourceCheck: true,
  // Только библиотека: приложение (src/routes) ходить по страницам вправе.
  scope: [/(^|\/)src\/lib\//],
  allow: [...NAV_PRIMITIVES, ADDRESS_LIB],
  message: ({ importer }) =>
    [
      '[layer-guard] goto из $app/navigation в библиотеке запрещён.',
      `  файл: ${importer || '<точка входа>'}`,
      '',
      '  Библиотечный компонент не ходит по адресам сам:',
      '',
      '    • адрес страницы меняется только через',
      "      writeAddress(...) из '#lib/address/sveltekit.js';",
      '    • переход по ссылке — через Link (`asLink`), не через goto;',
      '    • «после успеха — на другой экран» — решение приложения',
      '      (src/routes), а не библиотечного компонента.',
      '',
      '  Почему: goto с GET-адресом из панели — это ровно дефект /steps',
      '  (ход 262): навигация гибнет под модальным слоем. Исключения:',
      '  сам писатель и навигационные примитивы (Link, HoldButton).',
    ].join('\n'),
},

  {
    pattern: /^@ark-ui\/svelte\/dialog$/,
    allow: [MODALS_LIB],
    message: ({ source, importer }) =>
      [
        `[layer-guard] Прямой импорт «${source}» запрещён.`,
        `  файл: ${importer || '<точка входа>'}`,
        '',
        '  Модальный слой открывается ТОЛЬКО через хост:',
        '',
        "      import { openLayer } from '#lib/modals/index.js';",
        '      openLayer({ title: …, content: … });',
        '',
        '  Почему: на всю стопку существует ровно один Dialog.',
        '  Второй диалог — это второй focus-trap, второй scroll-lock',
        '  и второй aria-hidden поверх первого: фокус начинает',
        '  перебрасываться, а стопка и кнопка «Назад» ломаются.',
      ].join('\n'),
  },
  {
    pattern: /<dialog(\s|>)/i,
    isTemplateCheck: true,
    allow: [MODALS_LIB],
    message: ({ importer }) =>
      [
        `[layer-guard] Использование нативного <dialog> запрещено.`,
        `  файл: ${importer || '<точка входа>'}`,
        '',
        '  Все модальные окна открываются ТОЛЬКО через единую хост-систему:',
        '',
        "      import { useModals, openLayer } from '#lib/modals/index.js';",
        '      openLayer({ title: …, content: … });',
        '',
        '  Почему: нативный <dialog> работает мимо стека истории, z-index',
        '  и системы анимаций хоста. Используйте единую модальную систему.',
      ].join('\n'),
  },
  {
    // Сырые form-теги живут ТОЛЬКО в примитивах полей и в единственной
    // точке lib/form — её <Form> (тег формы + hidden-пары конверта).
    // Разрешение на всю папку lib/form было дырой: новый компонент с
    // голым <input> внутри библиотеки формы проходил мимо (вскрыто
    // 2026-10-21); полей внутри lib/form нет и быть не должно — поля
    // ей СНАРУЖИ подставляет конфиг приложения (components/form).
    // Потребитель (страница, фича, демо-блок) получает либо <Form> из
    // '#lib/form/svelte/index.js', либо поле из примитивов ('#lib/components/ui/index.js',
    // '#lib/components/settings/index.js') — тогда семантика (hidden-пары, no-JS GET,
    // aria-связи, оживление контролов) не теряется на каждом «удобном»
    // разметочном дубле. Исключение — оболочка (sidebar-чекбокс работает
    // без JS и не является полем).
    //
    // Узор закрыл дыры, найденные прогон образцов (2026-10-09): самозакрытый
    // <form/> и <input/>, закрывающий </form> (его раньше не было за что
    // ловить) и ВЕРХНИЙ регистр — HTML-теги без регистра, а предыдущая
    // версия сравнивала их чувствительно, в отличие от правила <dialog>.
    pattern: /<\/?(?:form|input|select|textarea|FORM|INPUT|SELECT|TEXTAREA)(?=[\s/>])/,
    isTemplateCheck: true,
    allow: [
      /(^|\/)src\/lib\/form\/svelte\/Form\.svelte$/,
      /(^|\/)src\/lib\/components\/ui\//,
      /(^|\/)src\/lib\/components\/settings\//,
      /(^|\/)src\/lib\/components\/shell\//,
      /(^|\/)node_modules\//,
    ],
    message: ({ importer }) =>
      [
        `[layer-guard] Сырой form-тег запрещён в этом файле.`,
        `  файл: ${importer || '<точка входа>'}`,
        '',
        '  Форма и поля собираются только из компонентов:',
        '',
        "      import { Form } from '#lib/form/svelte/index.js';     // тег <form> + hidden-пары",
        "      import { Input, Select, Checkbox } from '#lib/components/ui/index.js';",
        "      import { Field, Select, Toggle } from '#lib/components/settings/index.js'; // панели настроек",
        '',
        '  Почему: тег <form> обязан нести formProps() (метод, action, submit-',
        '  обработчик, novalidate после гидратации), а скрытые пары держат',
        '  чужие ключи адреса при no-JS GET. Всё это живёт в <Form> и в',
        '  примитивах полей; скопированная разметка теряет это молча.',
      ].join('\n'),
  },
  {
    // Носитель значения — виджет kit-internal: наружу отдаётся только
    // enhanced `Select`. Страница, взявшая `NativeSelect`, проходит проверку
    // «нет сырых тегов» (компонент с заглавной!) и молча понижает интерфейс
    // до стандартного ОС-дропдауна: без поиска, подсветки и host-раскрытия —
    // и тесты при этом зелёные, болячка 2026-10-10. Понижение запрещено.
    pattern: /<NativeSelect([ \t\n/>])/,
    isTemplateCheck: true,
    allow: [
      /(^|\/)src\/lib\/components\/ui\//,
      /(^|\/)src\/lib\/components\/settings\//,
      /(^|\/)src\/lib\/components\/shell\//,
      /(^|\/)node_modules\//,
    ],
    message: ({ importer }) =>
      [
        `[layer-guard] Стандартный носитель <NativeSelect> доступен только внутри кита.`,
        `  файл: ${importer || '<точка входа>'}`,
        '',
        '  Странице и демке положен расширенный select:',
        '',
        "      import { Select } from '#lib/components/ui/index.js';              // список — панель, значение — носитель в нём",
        "      import { Select as PanelSelect } from '#lib/components/settings/index.js'; // панели настроек",
        '',
        '  Почему: enhanced <Select> оставляет форму и no-JS на нативном',
        '  <select>-носителе (с опциями — nativeList), а список рисует',
        '  панелью. Голый носитель формально компонент, но UI — браузерный',
        '  dropdown; отличить их «по-человечески» разметка не обязана.',
      ].join('\n'),
  },
  {
    // Скрытое поле объявляет САМА lib/form: поле вида hidden в ОПИСАНИИ,
    // рисует его <Field> (HiddenField), значение живёт в состоянии формы;
    // конверт — hiddenFields у <Form>. Ручной <Input type="hidden"> в
    // виджете — значение, о котором форма не знает: не валидируется,
    // зеркалится в DOM руками, серверные ошибки повисают в воздухе.
    // Так AuthWidget вёз nonce и аватар до 2026-10-21.
    pattern: /<[A-Z][\w]*[^>]*\btype="hidden"/,
    isTemplateCheck: true,
    allow: [
      /(^|\/)src\/lib\/components\/form\//,
      /(^|\/)src\/lib\/components\/ui\//,
      /(^|\/)src\/lib\/components\/settings\//,
      /(^|\/)node_modules\//,
    ],
    message: ({ importer }) =>
      [
        `[layer-guard] Скрытое поле вручную запрещено в этом файле.`,
        `  файл: ${importer || '<точка входа>'}`,
        '',
        '  Скрытое поле объявляет описание формы, рисует lib/form:',
        '',
        "      nonce: field.hidden({ label: 'Nonce' }),          // описание (defineForm)",
        '      <Field of={bound.f.nonce} />                       // разметка (HiddenField)',
        '',
        '  Значение при этом живёт в состоянии формы (onInput/зеркало),',
        '  валидируется и уезжает одним путём с остальными полями.',
        '  Конверт формы рисует <Form hiddenFields={bound.hidden()}> —',
        '  руками скрытые поля не ставятся нигде.',
      ].join('\n'),
  },
  {
    // Имя поля даёт bind из описания (attrs), а не разметка. Полевой
    // примитив с рукописным name="..." вне кита форм — поле, попадающее
    // в FormData мимо описания, валидаторов и состояния: сценарий
    // «создалось поле, о котором lib/form не знает». Кнопки-интенты не
    // поля (их name — механизм интента самой lib/form) — правило только
    // о полевых примитивах ui. name={view.name} сознательно не ловится:
    // это ручная привязка FieldView (headless-путь, витрина демо) —
    // значение там всё равно живёт в состоянии формы.
    pattern: /<(?:Input|Textarea|AutoTextarea|Checkbox|Switch|Select|NativeSelect|FileInput|SearchInput|SearchField|SearchMorph|PhoneInput|OtpInput|PasswordInput|CopyInput|NumberField|NumberInput)\b[^>]*\bname\s*=\s*["']/,
    isTemplateCheck: true,
    allow: [
      /(^|\/)src\/lib\/components\/form\//,
      /(^|\/)src\/lib\/components\/ui\//,
      /(^|\/)src\/lib\/components\/settings\//,
      /(^|\/)src\/lib\/components\/shell\//,
      /(^|\/)node_modules\//,
    ],
    message: ({ importer }) =>
      [
        `[layer-guard] Поле с рукописным name= запрещено в этом файле.`,
        `  файл: ${importer || '<точка входа>'}`,
        '',
        '  Поле формы объявляется в описании и рисуется через Field —',
        '  имя, атрибуты проверки и значение даёт bind:',
        '',
        '      <Field of={bound.f.nickname} />',
        '',
        '  Примитив ui с собственным name= уезжает в FormData мимо',
        '  описания: форма о таком поле не знает, сервер получает',
        '  значение, которое никто не валидировал.',
      ].join('\n'),
  },
  {
    // Наоборот: lib/form — ниже компонентов, компоненты о ней не знают,
    // а она о них. Библиотека формы рендерит поля САМА через свой
    // механизм field (bind + конфиг приложения): компоненты полей ей
    // подставляет СНАРУЖИ конфигурация (components/form), а не импорт.
    // Прямой импорт любого компонента внутрь — поле, которое библиотека
    // вызвала в обход собственного field. Узор — по КАНОНУ пути
    // (`src/lib/components/...`): `#lib/`, `$lib/` и относительные
    // написания канонизируются до сверки, алиасом не обойти (раньше
    // узор смотрел только на `#lib/components/(ui|settings)/` — и
    // относительный путь, и слой components/form проходили мимо).
    pattern: /^src\/lib\/components\//,
    allow: [/.*/], // всем, кроме тех, кто в deny
    deny: [/(^|\/)src\/lib\/form\//],
    message: ({ source, importer }) =>
      [
        `[layer-guard] «${source}» недоступен внутри lib/form.`,
        `  файл: ${importer || '<неизвестный импортёр>'}`,
        '',
        '  Внутри библиотеки формы компоненты запрещены сознательно:',
        '  поля ей подставляет конфиг приложения СНАРУЖИ (components/form:',
        '  resolve по виду ввода), а внутри работает только её собственный',
        '  механизм field (FieldView/bind). UI-примитив — потребитель',
        '  form-контракта, а не его часть.',
        '  Нужен новый вид поля — добавьте тип и компонент в расширение',
        '  приложения (components/form) и зарегистрируйте в конфиге форм.',
      ].join('\n'),
  },
  {
    pattern: /^@zag-js\/(focus-trap|remove-scroll|aria-hidden)$/,
    allow: [/(^|\/)src\/lib\/overlay\//, /(^|\/)node_modules\//],
    message: ({ source, importer }) =>
      [
        `[layer-guard] «${source}» подключается только в src/lib/overlay.`,
        `  файл: ${importer || '<точка входа>'}`,
        '',
        '  Ловушка фокуса, scroll-lock и aria-hidden уже настроены',
        '  хостом один раз на всю стопку.',
      ].join('\n'),
  },

  /* ── обход lib/form запрещён ─────────────────────────────────────────── */

  {
    // Дыра разметочного правила: тег можно подставить динамикой.
    pattern: /<svelte:element[^>]*\bthis=(?:"|')?(?:\{[^}]*\}|["']?(?:form|input|select|textarea)\b)/,
    isTemplateCheck: true,
    allow: FORM_KEEPERS,
    message: ({ importer }) =>
      [
        `[layer-guard] <svelte:element this="form"> — тот же сырой тег, только динамикой.`,
        `  файл: ${importer || '<точка входа>'}`,
        '',
        "      import { Form } from '#lib/form/svelte/index.js';",
        '',
        '  Почему: обёртка держит formProps(), скрытые пары и no-JS-семантику.',
      ].join('\n'),
  },
  {
    // Контракт адаптера: `form` у <Form> — результат bind(). Подделать его
    // можно, только написав formProps самому, — это и запрещено.
    pattern: /\bformProps\s*[:=(]/,
    isSourceCheck: true,
    allow: FORM_KEEPERS,
    message: ({ importer }) =>
      [
        `[layer-guard] formProps собирает ТОЛЬКО bind() из '#lib/form/svelte/index.js'.`,
        `  файл: ${importer || '<точка входа>'}`,
        '',
        "      import { bind, Form } from '#lib/form/svelte/index.js';",
        '      const form = bind(forms, описание, { transport })',
        '',
        '  Почему: ручной formProps() даёт разметку без связки — без novalidate,',
        '  без живых проверок и МИМО серверных слоёв (идемпотентность, частота,',
        '  origin, лимит тела), а ошибки показывает фреймворк, а не приложение.',
        '  Нужен обычный POST без перехвата — `bind(..., { intercept: false })`:',
        '  тот же путь, но под контролем библиотеки.',
      ].join('\n'),
  },
  {
    pattern: /\bdocument\s*\.\s*createElement\s*\(\s*(?:"|')\s*(?:form|input|select|textarea)\b/i,
    isSourceCheck: true,
    allow: FORM_KEEPERS,
    message: ({ importer }) =>
      [
        `[layer-guard] createElement('form') обносит форму мимо lib/form.`,
        `  файл: ${importer || '<точка входа>'}`,
        '',
        '  Нужен submit вне разметки — возьмите форму из bind() и вызовите её',
        '  submit(), а не конструируйте узел вручную.',
      ].join('\n'),
  },
  {
    // Серверный приём собирается слоями: маршрут, читающий тело сам,
    // проходит мимо метода, origin, лимитов, имён и конверта.
    pattern: /\brequest\s*\.\s*(?:clone\s*\(\s*\)\s*\.\s*)?formData\s*\(|\bawait\s+request\s*\.\s*json\s*\(/,
    isSourceCheck: true,
    allow: [/(^|\/)src\/lib\/form\//, /(^|\/)node_modules\//, /(^|\/)tooling\//],
    require: /from ['"]#lib\/form\/server\.js['"]/,
    message: ({ importer }) =>
      [
        `[layer-guard] Тело запроса разбирают слои, а не маршрут.`,
        `  файл: ${importer || '<точка входа>'}`,
        '',
        "      import { createFormHandler } from '#lib/form/server.js';",
        '',
        '  До bodyLayer стоят метод, origin, предел тела со счётчиком, проверка',
        '  имён и конверт; свой request.formData() выбрасывает их молча.',
      ].join('\n'),
  },
  {
    pattern: /\bexport const actions\s*[:=]/,
    isSourceCheck: true,
    allow: [/(^|\/)src\/lib\/form\//, /(^|\/)node_modules\//, /(^|\/)tooling\//],
    // обёртка над слоями лежит рядом с маршрутом (`./handle`) или импортирует их сама
    require: /from ['"](?:#lib\/form\/|\.\.?\/handle(?:\.js)?['"])/,
    message: ({ importer }) =>
      [
        `[layer-guard] form-экшены обязаны идти через '#lib/form/index.js'.`,
        `  файл: ${importer || '<точка входа>'}`,
        '',
        "  Экшен = createFormHandler (или обёртка над ним рядом с маршрутом, как 'routes/(site)/(app)/form/handle.ts'):",
        '  тогда метод, origin, лимиты, имена, конверт и execute живут в одном',
        '  конвейере, а отказ приходит как Result, а не как страница фреймворка.',
      ].join('\n'),
  },
];

export default layerGuard;
