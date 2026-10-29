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

const SUBPATH_ALIASES = [
  ['#lib/', 'src/lib/'],
  ['$lib/', 'src/lib/'],
  ['#hooks/', 'src/hooks/'],
  ['#components/', 'src/components/'],
  ['#content/', 'src/content/'],
  ['#server/', 'src/server/'],
];

/**
 * Канонический вид спецификатора: все 5 subpath-алиасов (`#lib/*`, `#hooks/*`,
 * `#components/*`, `#content/*`, `#server/*`), `$lib/*` и относительные пути —
 * к пути от корня проекта (`src/...`). Импортное правило обязано ловить запрет
 * по СМЫСЛУ пути, а не по написанию — ни алиасом, ни `../../` не обойти.
 * Внешние пакеты и виртуальные модули (`$app/*`, `$env/*`) канона `src/...` не имеют — null.
 * @param {string} source сырой спецификатор, как написан
 * @param {string} importer нормализованный путь импортёра
 * @returns {string | null}
 */
export function canonSpecifier(source, importer) {
  for (const [prefix, target] of SUBPATH_ALIASES) {
    if (source.startsWith(prefix)) return target + source.slice(prefix.length);
  }
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
 * @property {(ctx: {source: string, canon: string | null, importer: string}) => boolean} [violates]
 *   дополнительное условие НАРУШЕНИЯ: правило срабатывает, только если функция
 *   вернула true. Нужно там, где запрет зависит от пары «кто → кого», а не от
 *   одной стороны (два маршрута из разных деревьев).
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
    const canon = canonSpecifier(src, from);
    for (const rule of rules) {
      if (rule.isTemplateCheck || rule.isSourceCheck) continue;
      if (!matchPattern(rule.pattern, src) && !(canon && matchPattern(rule.pattern, canon))) continue;
      if (rule.violates && !rule.violates({ source: src, canon, importer: from })) continue;
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
     * @param {{ ssr?: boolean }} [options]
     */
    resolveId(source, importer, options) {
      // В Vite 8 Environment API вызовы `fetchModule` для входных SSR-модулей
      // (`hooks.server.ts`, `+layout.server.ts`, `+page.server.ts`, `+server.ts`)
      // передают синтетический `importer = '<root>/index.html'`. Для SSR-окружения
      // это точка входа сервера (`undefined`), а в `client`-окружении `index.html`
      // остаётся клиентским импортёром и блокирует прямой запрос `/src/*.server.ts`.
      const isSsr = Boolean(options?.ssr || this.environment?.name === 'ssr');
      const effectiveImporter =
        isSsr && importer && /(^|[/\\])index\.html$/.test(importer) ? undefined : importer;
      const problem = check(source, effectiveImporter);
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
  /(^|\/)src\/hooks\/links\//,
  /(^|\/)src\/components\/ui\/button\/HoldButton\.svelte$/,
];
/** Чтение «реальности фреймворка» — обязанность ядра движка модалок. */
const MODALS_ENGINE = /(^|\/)src\/lib\/modals\/cores\//;
/** Правила адреса действуют на ИСХОДНИКИ проекта: node_modules SvelteKit вправе
 *  упоминать page.url в своих рантайм-файлах и сообщениях. */
const SRC_ONLY = [/(^|\/)src\//];
/** Допущенное место перевода файла в `base64`: конструктор `/fields`
 *  (аватары профиля переведены на короткие URL боевого хранилища `/api/storage/avatars/…`). */
const FILE_TO_BASE64_KEEPERS = [
  /(^|\/)src\/routes\/\(site\)\/\(app\)\/fields\/fields\.form\.server\.ts$/,
];
/** Кто имеет право на сырые form-теги и на собственный разбор тела. */
const FORM_KEEPERS = [
  /(^|\/)src\/lib\/form\//,
  /(^|\/)src\/components\/ui\//,
  /(^|\/)src\/components\/settings\//,
  /(^|\/)src\/components\/shell\//,
  /(^|\/)node_modules\//,
  /(^|\/)tooling\//,
];
/** Серверные файлы SvelteKit и модулей (`*.server.*`, `+server.*`, `.svelte-kit/*`, SSR entrypoints, тесты и tooling). */
const SERVER_IMPORTERS = [
  /^$/,
  /\.server\.(?:ts|js|mts|mjs)$/,
  /(^|\/)\+server\.(?:ts|js)$/,
  /(^|\/)\.svelte-kit\//,
  /(^|\/)node_modules\//,
  /\.(?:test|spec)\.(?:ts|js|mts|mjs|svelte)$/,
  /(^|\/)tooling\//,
  /(^|\/)vite\.config\.ts$/,
];

/** @param {RegExp} re */
const NON_TEST = (re) =>
  new RegExp(`${re.source}(?!.*\\.(?:test|spec)\\.(?:ts|js|mts|mjs|svelte)$)`);

/**
 * Дерево маршрута: путь до первой НЕ-группы после `src/routes/`
 * (`src/routes/(site)/(app)/db-demo/x.ts` → `src/routes/(site)/(app)/db-demo`).
 * Группа без имени (`(site)`) — общая папка, из неё законно брать общее.
 * @param {string | undefined | null} path
 * @returns {string | null}
 */
export function routeTree(path) {
  const p = norm(path)
  const at = p.indexOf('src/routes/')
  if (at < 0) return null
  const parts = p.slice(at + 'src/routes/'.length).split('/')
  const kept = []
  for (const part of parts.slice(0, -1)) {
    kept.push(part)
    if (!part.startsWith('(')) break
  }
  if (!kept.length) return null
  return `src/routes/${kept.join('/')}`
}

/** @param {string} source @param {string | undefined} importer */
function canonOf(source, importer) {
  return canonSpecifier(norm(source), norm(importer))
}

/** @type {Rule[]} */
export const RULES = [
  /* ── 1. Строгая направленность 5 верхних слоёв и серверная граница ── */
  {
    pattern: /^src\/(?:hooks|components|content|server|routes)\//,
    allow: [/.*/],
    deny: [NON_TEST(/(^|\/)src\/lib\//)],
    message: ({ source, importer }) =>
      [
        `[layer-guard] Нарушение иерархии слоёв: пакет нижнего слоя \`src/lib/\` не может импортировать «${source}».`,
        `  файл: ${importer || '<неизвестный импортёр>'}`,
        '',
        '  Слой `#lib/*` полностью независим от хуков приложения, UI-компонентов,',
        '  доменного контента, серверных синглтонов и маршрутов.',
      ].join('\n'),
  },
  {
    pattern: /^src\/(?:components|content|routes)\//,
    allow: [/.*/],
    deny: [NON_TEST(/(^|\/)src\/hooks\//)],
    message: ({ source, importer }) =>
      [
        `[layer-guard] Нарушение иерархии слоёв: \`src/hooks/\` не может импортировать «${source}».`,
        `  файл: ${importer || '<неизвестный импортёр>'}`,
        '',
        '  Хуки (`#hooks/*`) стоят ниже UI-компонентов (`#components/*`), контента (`#content/*`) и роутов.',
      ].join('\n'),
  },
  {
    pattern: /^src\/(?:content|server|routes)\//,
    allow: [/.*/],
    deny: [NON_TEST(/(^|\/)src\/components\//)],
    message: ({ source, importer }) =>
      [
        `[layer-guard] Нарушение иерархии слоёв: UI-компонент из \`src/components/\` не может импортировать «${source}».`,
        `  файл: ${importer || '<неизвестный импортёр>'}`,
        '',
        '  Компоненты (`#components/*`) получают данные и маршруты через пропы/слоты,',
        '  а не тянут доменный контент (`#content/*`), серверные синглтоны (`#server/*`) или роуты.',
      ].join('\n'),
  },
  {
    pattern: /^src\/routes\//,
    allow: [/.*/],
    deny: [NON_TEST(/(^|\/)src\/(?:content|server)\//)],
    message: ({ source, importer }) =>
      [
        `[layer-guard] Нарушение иерархии слоёв: модуль ниже \`src/routes/\` не может импортировать маршрут «${source}».`,
        `  файл: ${importer || '<неизвестный импортёр>'}`,
        '',
        '  Вынесите общую схему, модель или UI-представление в `#content/*` или `#components/*`.',
      ].join('\n'),
  },
  {
    pattern: /^src\/components\//,
    allow: [/.*/],
    deny: [NON_TEST(/(^|\/)src\/server\//)],
    message: ({ source, importer }) =>
      [
        `[layer-guard] Серверный слой \`src/server/\` не может импортировать UI-компоненты («${source}»).`,
        `  файл: ${importer || '<неизвестный импортёр>'}`,
      ].join('\n'),
  },
  {
    /**
     * Сосед по `src/routes/` — не библиотека: у каждой страницы своя жизнь и
     * свои данные. Общий код живёт слоем ниже (`#content/*`, `#components/*`,
     * `#hooks/*`), а не «взят у соседней страницы». Разрешено только своё
     * дерево: файл внутри него или общая папка над ним (`(site)/nav.ts`).
     */
    pattern: /^src\/routes\//,
    allow: [],
    violates: ({ canon, importer }) => {
      const from = routeTree(importer)
      const to = canon ? routeTree(canon) : null
      if (!from || !to) return false
      return !(from === to || from.startsWith(`${to}/`) || to.startsWith(`${from}/`))
    },
    message: ({ source, importer }) => {
      const from = routeTree(importer)
      const to = routeTree(canonOf(source, importer))
      return [
        `[layer-guard] Маршрут импортирует соседний маршрут («${source}»).`,
        `  файл: ${importer || '<точка входа>'}`,
        `  дерево: ${from ?? '?'} → ${to ?? '?'}`,
        '',
        '  Страницы не знают друг о друге: общее выносится в `#content/*`,',
        '  `#components/*` или `#hooks/*` — туда, где это переиспользуемо по смыслу,',
        '  а не потому, что «так быстрее».',
      ].join('\n')
    },
  },
  {
    pattern: /\.server(?:\.(?:ts|js|mts|mjs))?$/,
    allow: SERVER_IMPORTERS,
    message: ({ source, importer }) =>
      [
        `[layer-guard] Серверный модуль «${source}» импортирован в клиентский/изоморфный файл.`,
        `  файл: ${importer || '<точка входа>'}`,
        '',
        '  Импортировать `*.server.ts` разрешено только из серверных файлов:',
        '  `*.server.ts`, `hooks.server.ts`, `+page.server.ts`, `+layout.server.ts`, `+server.ts`.',
      ].join('\n'),
  },
  {
    pattern: /^\$lib\//,
    allow: [/(^|\/)node_modules\//],
    message: ({ source, importer }) =>
      [
        `[layer-guard] Импорт «${source}» через устаревший алиас \`$lib\` запрещён.`,
        `  файл: ${importer || '<точка входа>'}`,
        '',
        '  В проекте пять именованных подпутей: `#lib/*`, `#hooks/*`, `#components/*`,',
        '  `#content/*`, `#server/*`. `$lib` размывает слой: по нему нельзя отличить',
        '  библиотеку от приложения — используйте `#lib/...` (или другой слой по смыслу).',
      ].join('\n'),
  },
  {
    pattern: /^\$(?:app|env)\//,
    allow: [/.*/],
    deny: [/(^|\/)src\/server\/trusted-origins\.ts$/],
    message: ({ source, importer }) =>
      [
        `[layer-guard] В \`trusted-origins.ts\` запрещён импорт «${source}».`,
        `  файл: ${importer || '<неизвестный импортёр>'}`,
        '',
        '  `vite.config.ts` импортирует `src/server/trusted-origins.ts` до инициализации',
        '  виртуальных модулей SvelteKit — используйте только чистый `process.env`.',
      ].join('\n'),
  },

  /* ── 2. Адрес: чтение и запись GET — только через #lib/address ──────── */
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
        '  Это запись адреса — её делает общий писатель (shallow-безопасная очередь):',
        '',
        "      import { writeAddress } from '#lib/address/sveltekit.js';",
        "      void writeAddress(() => ({ url, state }), { replace: true, load: false });",
      ].join('\n'),
  },
  {
    pattern: /\bpage\s*\.\s*url\b/,
    isSourceCheck: true,
    scope: SRC_ONLY,
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
      ].join('\n'),
  },
  {
    pattern: /import\s*\{[\s\S]*?\bgoto\b[\s\S]*?\}\s*from\s*['"]\$app\/navigation['"]/,
    isSourceCheck: true,
    scope: [/(^|\/)src\/(?:lib|hooks|components)\//],
    allow: [...NAV_PRIMITIVES, ADDRESS_LIB],
    message: ({ importer }) =>
      [
        '[layer-guard] goto из $app/navigation в библиотеках и UI-компонентах запрещён.',
        `  файл: ${importer || '<точка входа>'}`,
        '',
        '  Библиотечный/UI-компонент не ходит по адресам сам:',
        '',
        '    • адрес страницы меняется только через',
        "      writeAddress(...) из '#lib/address/sveltekit.js';",
        '    • переход по ссылке — через Link (`asLink`), не через goto;',
        '    • «после успеха — на другой экран» — решение доменного слоя/роута.',
      ].join('\n'),
  },

  /* ── 3. Оверлей и модальные окна ────────────────────────────────────── */
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
      ].join('\n'),
  },
  {
    pattern: /^@zag-js\/(focus-trap|remove-scroll|aria-hidden)$/,
    allow: [/(^|\/)src\/lib\/overlay\//, /(^|\/)node_modules\//],
    message: ({ source, importer }) =>
      [
        `[layer-guard] «${source}» подключается только в src/lib/overlay.`,
        `  файл: ${importer || '<точка входа>'}`,
      ].join('\n'),
  },

  /* ── 4. Теги форм и обход lib/form ──────────────────────────────────── */
  {
    pattern: /<\/?(?:form|input|select|textarea|FORM|INPUT|SELECT|TEXTAREA)(?=[\s/>])/,
    isTemplateCheck: true,
    allow: [
      /(^|\/)src\/lib\/form\/svelte\/Form\.svelte$/,
      /(^|\/)src\/components\/ui\//,
      /(^|\/)src\/components\/settings\//,
      /(^|\/)src\/components\/shell\//,
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
        "      import { Input, Select, Checkbox } from '#components/ui/index.js';",
        "      import { Field, Select, Toggle } from '#components/settings/index.js'; // панели настроек",
      ].join('\n'),
  },
  {
    pattern: /<[A-Z][\w]*[^>]*\btype="hidden"/,
    isTemplateCheck: true,
    allow: [
      /(^|\/)src\/components\/form\//,
      /(^|\/)src\/components\/ui\//,
      /(^|\/)src\/components\/settings\//,
      /(^|\/)node_modules\//,
    ],
    message: ({ importer }) =>
      [
        `[layer-guard] Скрытое поле вручную запрещено в этом файле.`,
        `  файл: ${importer || '<точка входа>'}`,
        '',
        '  Скрытое поле объявляет описание формы, рисует lib/form:',
        '',
        "      nonce: field.hidden({ label: 'Nonce' }),",
        '      <Field of={bound.f.nonce} />',
      ].join('\n'),
  },
  {
    pattern: /<(?:Input|Textarea|AutoTextarea|Checkbox|Switch|RadioGroup|RadioItem|Range|Select|FileInput|FileAttachment|Attachment|SearchInput|SearchField|PhoneInput|OtpInput|PasswordInput|CopyInput|NumberField|NumberInput)\b[^>]*\bname\s*=\s*["']/,
    isTemplateCheck: true,
    allow: [
      /(^|\/)src\/components\/form\//,
      /(^|\/)src\/components\/ui\//,
      /(^|\/)src\/components\/settings\//,
      /(^|\/)src\/components\/shell\//,
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
      ].join('\n'),
  },
  {
    pattern: /<svelte:element[^>]*\bthis=(?:"|')?(?:\{[^}]*\}|["']?(?:form|input|select|textarea)\b)/,
    isTemplateCheck: true,
    allow: FORM_KEEPERS,
    message: ({ importer }) =>
      [
        `[layer-guard] <svelte:element this="form"> — тот же сырой тег, только динамикой.`,
        `  файл: ${importer || '<точка входа>'}`,
        '',
        "      import { Form } from '#lib/form/svelte/index.js';",
      ].join('\n'),
  },
  {
    // Файл целиком в base64 — это и чтение всех байт в память, и сборка строки:
    // ловим пару в любом порядке линейной альтернативой (без O(n²) lookahead с [\s\S]*
    // на каждой позиции файла), не задевая `btoa` над ключами/курсорами и побайтовые
    // чтения заголовков (`slice(...).arrayBuffer()`).
    pattern:
      /\bbtoa\s*\([\s\S]*?(?:\.\s*arrayBuffer\s*\(\s*\)|\bFileReader\b)|(?:\.\s*arrayBuffer\s*\(\s*\)|\bFileReader\b)[\s\S]*?\bbtoa\s*\(/,
    isSourceCheck: true,
    scope: SRC_ONLY,
    allow: FILE_TO_BASE64_KEEPERS,
    message: ({ importer }) =>
      [
        '[layer-guard] Новое место перевода файла в base64 запрещено.',
        `  файл: ${importer || '<точка входа>'}`,
        '',
        '  В base64 файл переводит только конструктор /fields.',
        '',
        '  Новому коду base64 не нужен: храните файл и отдавайте URL.',
        '  Заголовок (магические байты) читайте через `blob.slice(0, N)` — см. `probeImageHeader`.',
      ].join('\n'),
  },
  {
    pattern: /\bformProps\s*[:=(]/,
    isSourceCheck: true,
    allow: FORM_KEEPERS,
    message: ({ importer }) =>
      [
        `[layer-guard] formProps собирает ТОЛЬКО bind() из '#lib/form/svelte/index.js'.`,
        `  файл: ${importer || '<точка входа>'}`,
        '',
        "      import { bind, Form } from '#lib/form/svelte/index.js';",
        '      Нужен обычный POST без перехвата — `bind(..., { intercept: false })`.',
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
      ].join('\n'),
  },
  {
    pattern: /\.(?:error|pending)[ \t]*=(?![=>])/,
    isSourceCheck: true,
    scope: SRC_ONLY,
    allow: [/(^|\/)src\/lib\/form\//, /(^|\/)src\/components\/form\//],
    require: /\b(?:takeover\s*=|FieldTakeover\b|FieldHandle\b)/,
    message: ({ importer }) =>
      [
        '[layer-guard] f.error/f.pending — писатели ТОЛЬКО перехватчика поля (Field takeover).',
        `  файл: ${importer || '<точка входа>'}`,
        '',
        '      <Field of={bound.f.поле} takeover={(f) => { f.error = { code } }} />',
      ].join('\n'),
  },
  {
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
      ].join('\n'),
  },
  {
    pattern: /\bexport const actions\s*[:=]/,
    isSourceCheck: true,
    allow: [/(^|\/)src\/lib\/form\//, /(^|\/)node_modules\//, /(^|\/)tooling\//],
    require: /from ['"](?:#lib\/form\/|\.\.?\/handle(?:\.server)?(?:\.js)?['"])/,
    message: ({ importer }) =>
      [
        `[layer-guard] form-экшены обязаны идти через '#lib/form/index.js'.`,
        `  файл: ${importer || '<точка входа>'}`,
      ].join('\n'),
  },
];

export default layerGuard;
