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
 * @typedef {object} Rule
 * @property {RegExp | string} pattern
 * @property {boolean} [isTemplateCheck] правило по разметке (.svelte/.html)
 * @property {boolean} [isSourceCheck] правило по ЛЮБОМУ исходнику: .ts/.js тоже,
 *   иначе обход прячется в скрипте (`document.createElement('form')`, ручные
 *   `formProps`) — там, где разметочные правила не действуют.
 * @property {(RegExp | string)[]} [allow]
 * @property {(RegExp | string)[]} [deny]
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
    for (const rule of rules) {
      if (rule.isTemplateCheck) continue;
      if (!matchPattern(rule.pattern, src)) continue;
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
/** Кто имеет право на сырые form-теги и на собственный разбор тела. */
const FORM_KEEPERS = [
  /(^|\/)src\/lib\/form\//,
  /(^|\/)src\/lib\/ui\/primitives\//,
  /(^|\/)src\/lib\/ui\/settings\//,
  /(^|\/)src\/lib\/shell\//,
  /(^|\/)node_modules\//,
  /(^|\/)tooling\//,
];

/** @type {Rule[]} */
export const RULES = [
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
        "      import { openLayer } from '$lib/modals';",
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
        "      import { useModals, openLayer } from '$lib/modals';",
        '      openLayer({ title: …, content: … });',
        '',
        '  Почему: нативный <dialog> работает мимо стека истории, z-index',
        '  и системы анимаций хоста. Используйте единую модальную систему.',
      ].join('\n'),
  },
  {
    // Сырые form-теги живут ТОЛЬКО в библиотеке формы и в примитивах полей.
    // Потребитель (страница, фича, демо-блок) получает либо <Form> из
    // '$lib/form/svelte', либо поле из примитивов ('$lib/ui/primitives',
    // '$lib/ui/settings') — тогда семантика (hidden-пары, no-JS GET,
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
      /(^|\/)src\/lib\/form\//,
      /(^|\/)src\/lib\/ui\/primitives\//,
      /(^|\/)src\/lib\/ui\/settings\//,
      /(^|\/)src\/lib\/shell\//,
      /(^|\/)node_modules\//,
    ],
    message: ({ importer }) =>
      [
        `[layer-guard] Сырой form-тег запрещён в этом файле.`,
        `  файл: ${importer || '<точка входа>'}`,
        '',
        '  Форма и поля собираются только из компонентов:',
        '',
        "      import { Form } from '$lib/form/svelte';     // тег <form> + hidden-пары",
        "      import { Input, Select, Checkbox } from '$lib/ui/primitives';",
        "      import { Field, Select, Toggle } from '$lib/ui/settings'; // панели настроек",
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
      /(^|\/)src\/lib\/ui\/primitives\//,
      /(^|\/)src\/lib\/ui\/settings\//,
      /(^|\/)src\/lib\/shell\//,
      /(^|\/)node_modules\//,
    ],
    message: ({ importer }) =>
      [
        `[layer-guard] Стандартный носитель <NativeSelect> доступен только внутри кита.`,
        `  файл: ${importer || '<точка входа>'}`,
        '',
        '  Странице и демке положен расширенный select:',
        '',
        "      import { Select } from '$lib/ui/primitives';              // список — панель, значение — носитель в нём",
        "      import { Select as PanelSelect } from '$lib/ui/settings'; // панели настроек",
        '',
        '  Почему: enhanced <Select> оставляет форму и no-JS на нативном',
        '  <select>-носителе (с опциями — nativeList), а список рисует',
        '  панелью. Голый носитель формально компонент, но UI — браузерный',
        '  dropdown; отличить их «по-человечески» разметка не обязана.',
      ].join('\n'),
  },
  {
    // Наоборот: lib/form — ниже примитивов, примитивы о ней не знают.
    // Библиотека формы рендерит поля САМА (bind/config/ui-политика);
    // импорт UI-примитива внутрь провайдера означал бы, что «свой field»
    // куда-то делся и его подменяют чужой разметкой.
    pattern: /^\$lib\/ui\/(primitives|settings)(\/|$)/,
    allow: [/.*/], // всем, кроме тех, кто в deny
    deny: [/(^|\/)src\/lib\/form\//],
    message: ({ source, importer }) =>
      [
        `[layer-guard] «${source}» недоступен внутри lib/form.`,
        `  файл: ${importer || '<неизвестный импортёр>'}`,
        '',
        '  Внутри библиотеки формы примитивы UI запрещены сознательно:',
        '  провайдер живёт на СОБСТВЕННЫХ полях (field/BoundForm + config.ui),',
        '  а UI-примитив — потребитель form-контракта, а не его часть.',
        '  Нужен новый вид поля — добавьте его в lib/form (ui.fieldComponent)',
        '  и зарегистрируйте в конфигурации страницы.',
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
        "      import { Form } from '$lib/form/svelte';",
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
        `[layer-guard] formProps собирает ТОЛЬКО bind() из '$lib/form/svelte'.`,
        `  файл: ${importer || '<точка входа>'}`,
        '',
        "      import { bind, Form } from '$lib/form/svelte';",
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
    require: /from ['"]\$lib\/form\/server['"]/,
    message: ({ importer }) =>
      [
        `[layer-guard] Тело запроса разбирают слои, а не маршрут.`,
        `  файл: ${importer || '<точка входа>'}`,
        '',
        "      import { createFormHandler } from '$lib/form/server';",
        '',
        '  До bodyLayer стоят метод, origin, предел тела со счётчиком, проверка',
        '  имён и конверт; свой request.formData() выбрасывает их молча.',
      ].join('\n'),
  },
  {
    pattern: /\bexport const actions\s*[:=]/,
    isSourceCheck: true,
    allow: [/(^|\/)src\/lib\/form\//, /(^|\/)node_modules\//, /(^|\/)tooling\//],
    require: /from ['"]\$lib\/(?:ui\/demo\/)?form(?:\/|['"])/,
    message: ({ importer }) =>
      [
        `[layer-guard] form-экшены обязаны идти через '$lib/form'.`,
        `  файл: ${importer || '<точка входа>'}`,
        '',
        "  Экшен = createFormHandler (или обёртка над ним, как '$lib/ui/demo/form/handle.ts'):",
        '  тогда метод, origin, лимиты, имена, конверт и execute живут в одном',
        '  конвейере, а отказ приходит как Result, а не как страница фреймворка.',
      ].join('\n'),
  },
];

export default layerGuard;
