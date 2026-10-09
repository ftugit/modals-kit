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
 * @property {boolean} [isTemplateCheck]
 * @property {(RegExp | string)[]} [allow]
 * @property {(RegExp | string)[]} [deny]
 * @property {string | ((ctx: {source: string, importer: string, rule: Rule}) => string)} message
 */

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
  const file = norm(id);
  for (const rule of rules) {
    if (!rule.isTemplateCheck) continue;
    if (!matchPattern(rule.pattern, code)) continue;
    const allowed = (rule.allow ?? []).some((a) => matchPattern(a, file));
    if (allowed) continue;
    return typeof rule.message === 'function'
      ? rule.message({ source: code, importer: file, rule })
      : rule.message;
  }
  return null;
}

/**
 * @param {Rule[]} rules
 * @returns {import('vite').Plugin}
 */
export function layerGuard(rules) {
  const check = createGuard(rules);
  const templateRules = rules.filter((r) => r.isTemplateCheck);
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
      if (!id.endsWith('.svelte') && !id.endsWith('.html')) return null;
      const msg = checkTemplate(templateRules, code, id);
      if (msg) this.error(msg);
      return null;
    },
  };
}

/* ── правила проекта ───────────────────────────────────────────────── */

const MODALS_LIB = /(^|\/)src\/lib\/modals\//;

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
    pattern: /<(form|input|select|textarea)([ \t\n>])/,
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
];

export default layerGuard;
