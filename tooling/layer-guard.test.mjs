import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonSpecifier, createGuard, checkTemplate, checkSource, layerGuard, RULES } from './layer-guard.mjs';
import { collectSpecifiers } from './core-purity.mjs';

const check = createGuard(RULES);

test('canonSpecifier приводит все 5 subpath-алиасов и относительные пути к src/...', () => {
  assert.equal(canonSpecifier('#lib/form/index.js', '/app/src/routes/+page.ts'), 'src/lib/form/index.js');
  assert.equal(canonSpecifier('$lib/form/index.js', '/app/src/routes/+page.ts'), 'src/lib/form/index.js');
  assert.equal(canonSpecifier('#hooks/js-only.svelte.js', '/app/src/routes/+page.ts'), 'src/hooks/js-only.svelte.js');
  assert.equal(canonSpecifier('#components/ui/index.js', '/app/src/routes/+page.ts'), 'src/components/ui/index.js');
  assert.equal(canonSpecifier('#content/user/index.js', '/app/src/routes/+page.ts'), 'src/content/user/index.js');
  assert.equal(canonSpecifier('#server/db.server.js', '/app/src/routes/+page.server.ts'), 'src/server/db.server.js');
  assert.equal(canonSpecifier('../../components/ui/index.js', '/app/src/lib/form/bind.ts'), 'src/components/ui/index.js');
  assert.equal(canonSpecifier('$app/paths', '/app/src/routes/+page.ts'), null);
});

test('строгая направленность 5 слоёв: запрещает восходящие импорты', () => {
  // lib не знает ни про один слой выше себя
  assert.ok(check('#hooks/js-only.svelte.js', '/app/src/lib/address/index.ts'));
  assert.ok(check('#components/ui/index.js', '/app/src/lib/form/svelte/provider.svelte'));
  assert.ok(check('#content/user/index.js', '/app/src/lib/modals/index.ts'));
  assert.ok(check('#server/db.server.js', '/app/src/lib/db/index.ts'));

  // hooks не импортирует components, content, routes
  assert.ok(check('#components/ui/index.js', '/app/src/hooks/js-only.svelte.ts'));
  assert.ok(check('#content/user/index.js', '/app/src/hooks/component-form/index.ts'));

  // components не импортирует content, server, routes
  assert.ok(check('#content/user/index.js', '/app/src/components/shell/AppShell.svelte'));
  assert.ok(check('#server/db.server.js', '/app/src/components/ErrorPage.svelte'));
  assert.ok(check('../../../../routes/(site)/nav.js', '/app/src/components/shell/ui/header/NavSlot.svelte'));

  // content и server не импортируют routes; server не импортирует components
  assert.ok(check('../../../routes/(site)/(app)/db-demo/handle.server.js', '/app/src/content/demo-catalog/posts/list.server.ts'));
  assert.ok(check('#components/ui/index.js', '/app/src/server/db.server.ts'));
});

test('граница *.server.ts и чистота trusted-origins.ts', () => {
  assert.ok(check('#server/db.server.js', '/app/src/routes/(site)/+page.svelte'));
  assert.ok(check('#content/user/gateway.server.js', '/app/src/content/user/ui/UserMenu.svelte'));
  assert.equal(check('#server/db.server.js', '/app/src/routes/(site)/+page.server.ts'), null);
  assert.equal(check('#content/user/gateway.server.js', '/app/src/hooks.server.ts'), null);
  assert.equal(check('./schema.server.js', '/app/src/content/demo-catalog/shikimori/filters.server.ts'), null);
  assert.equal(check('../../../src/hooks.server.ts', '/app/.svelte-kit/generated/dev/server.js'), null);
  assert.equal(check('/app/src/routes/(site)/+layout.server.ts', undefined), null);
  assert.equal(check('../../routes/(site)/(app)/fields/demo-schema.ts', '/app/src/components/demo/schemas.test.ts'), null);

  assert.ok(check('$app/paths', '/app/src/server/trusted-origins.ts'));
  assert.ok(check('$env/static/private', '/app/src/server/trusted-origins.ts'));

  // Vite 8 Environment API `fetchModule`: SSR-вход с синтетическим `<root>/index.html` разрешён,
  // а прямой запрос `/src/*.server.ts` в `client`-окружении блокируется.
  const plugin = layerGuard(RULES);
  const ssrErrors = [];
  plugin.resolveId.call(
    { environment: { name: 'ssr' }, error: (m) => ssrErrors.push(m) },
    '/src/routes/(site)/+layout.server.ts',
    '/app/index.html',
  );
  assert.equal(ssrErrors.length, 0);

  const clientErrors = [];
  plugin.resolveId.call(
    { environment: { name: 'client' }, error: (m) => clientErrors.push(m) },
    '/src/server/db.server.ts',
    '/app/index.html',
  );
  assert.equal(clientErrors.length, 1);
});

test('запрещает dialog вне lib/modals', () => {
  const msg = check('@ark-ui/svelte/dialog', '/app/src/features/card.svelte');
  assert.ok(msg, 'должно вернуть ошибку');
  assert.match(msg, /запрещён/);
  assert.match(msg, /openLayer/, 'сообщение обязано подсказывать замену');
});

test('разрешает dialog внутри lib/modals', () => {
  assert.equal(check('@ark-ui/svelte/dialog', '/app/src/lib/modals/host.svelte'), null);
});

test('разрешает вложенные файлы lib/modals', () => {
  assert.equal(check('@ark-ui/svelte/dialog', '/app/src/lib/modals/parts/stack.svelte'), null);
});

test('не задевает другие подпакеты Ark', () => {
  assert.equal(check('@ark-ui/svelte/combobox', '/app/src/components/ui/select.svelte'), null);
  assert.equal(check('@ark-ui/svelte/menu', '/app/src/components/ui/menu.svelte'), null);
});

test('возможности слоя — только в lib/overlay', () => {
  assert.ok(check('@zag-js/focus-trap', '/app/src/components/ui/select.svelte'));
  assert.equal(check('@zag-js/focus-trap', '/app/src/lib/overlay/index.ts'), null);
  assert.ok(check('@zag-js/remove-scroll', '/app/src/features/x.ts'));
  assert.ok(check('@zag-js/aria-hidden', '/app/src/features/x.ts'));
});

test('dismissable НЕ запрещён (нужен drawer для no-JS)', () => {
  assert.equal(check('@zag-js/dismissable', '/app/src/hooks/use-drawer.svelte.ts'), null);
});

test('windows-разделители нормализуются', () => {
  assert.equal(check('@ark-ui/svelte/dialog', 'C:\\app\\src\\lib\\modals\\host.svelte'), null);
});

test('query-суффикс Vite не ломает разрешение', () => {
  assert.equal(
    check('@ark-ui/svelte/dialog', '/app/src/lib/modals/host.svelte?svelte&type=script'),
    null,
  );
});

test('точка входа без importer тоже проверяется', () => {
  assert.ok(check('@ark-ui/svelte/dialog', undefined));
});

test('известное ограничение: вычисляемый спецификатор не ловится', () => {
  const computed = '@ark-ui/svelte/' + 'dialog';
  assert.ok(check(computed, '/app/src/features/x.ts'));
  assert.equal(check('@ark-ui/svelte/${part}', '/app/src/features/x.ts'), null);
});

/* ── сырые form-теги: только библиотека формы и примитивы полей ──────── */

test('сырой <input> на странице — ошибка, подсказывающая замену', () => {
  const msg = checkTemplate(RULES, '<template><input name="q" /></template>', '/app/src/routes/search/+page.svelte');
  assert.ok(msg, 'должно вернуть ошибку');
  assert.match(msg, /Form.*from '#lib\/form\/svelte\/index\.js'/s);
  assert.match(msg, /#components\/ui\/index\.js/);
});

test('<form>/<input> разрешены в lib/form', () => {
  assert.equal(checkTemplate(RULES, '<form {...attrs}><input /></form>', '/app/src/lib/form/svelte/Form.svelte'), null);
});

test('примитивы полей и виджеты панелей — свои теги законны', () => {
  assert.equal(checkTemplate(RULES, '<input />', '/app/src/components/ui/input/Input.svelte'), null);
  assert.equal(checkTemplate(RULES, '<select></select>', '/app/src/components/ui/native-select/NativeSelect.svelte'), null);
  assert.equal(checkTemplate(RULES, '<input />', '/app/src/components/settings/Toggle.svelte'), null);
});

test('оболочка (sidebar) — исключение владельца', () => {
  assert.equal(checkTemplate(RULES, '<input type="checkbox" />', '/app/src/components/shell/AppShell.svelte'), null);
});

test('node_modules (Ark UI рендерит скрытые input сам) не под проверкой', () => {
  assert.equal(checkTemplate(RULES, '<input />', '/app/node_modules/@ark-ui/svelte/checkbox.svelte'), null);
});

test('<Form /> (компонент, не тег) не задевает правило; тег — различим', () => {
  assert.equal(checkTemplate(RULES, '<Form {form}><span /></Form>', '/app/src/routes/x/+page.svelte'), null);
  assert.ok(checkTemplate(RULES, '<form action="/x"><span /></form>', '/app/src/routes/x/+page.svelte'));
});

test('импорт примитивов разрешён всем выше или внутри components', () => {
  assert.equal(check('#components/ui/index.js', '/app/src/routes/form/+page.svelte'), null);
  assert.equal(check('#components/ui/index.js', '/app/src/components/form/Field.svelte'), null);
  assert.equal(check('#components/utils.js', '/app/src/content/user/ui/Acl.svelte'), null);
});

test('template: <NativeSelect> вне кита блокируется с подсказкой enhanced Select', () => {
  const msg = checkTemplate(RULES, '<div><NativeSelect name="s" /></div>', '/app/src/routes/demo/+page.svelte');
  assert.match(msg, /только внутри кита/);
  assert.match(msg, /#components\/ui/);
});

test('template: <NativeSelect /> самозакрытый тоже блокируется; enhanced <Select /> — нет', () => {
  assert.notEqual(checkTemplate(RULES, '<NativeSelect />', '/app/src/features/x.svelte'), null);
  assert.equal(checkTemplate(RULES, '<Select options={opts} />', '/app/src/features/x.svelte'), null);
});

test('template: кит собирает носитель сам — settings и shell легальны', () => {
  assert.equal(checkTemplate(RULES, '<NativeSelect {name}/>', '/app/src/components/settings/Select.svelte'), null);
  assert.equal(checkTemplate(RULES, '<NativeSelect {name}/>', '/app/src/components/shell/sidebar.svelte'), null);
});

/* ── обход lib/form ──────────────────────────────────────────────────── */

const ROUTE = '/app/src/routes/x/+page.svelte';
const SERVER = '/app/src/routes/x/+page.server.ts';

test('template: самозакрытый и закрывающий form-теги ловятся', () => {
  assert.ok(checkTemplate(RULES, '<form/>', ROUTE));
  assert.ok(checkTemplate(RULES, '<input/>', ROUTE));
  assert.ok(checkTemplate(RULES, '<span></span></form>', ROUTE));
});

test('template: ВЕРХНИЙ регистр — те же теги, ловится', () => {
  assert.ok(checkTemplate(RULES, '<FORM method="post">', ROUTE));
  assert.ok(checkTemplate(RULES, '<SELECT name="a">', ROUTE));
});

test('template: компоненты с заглавной не задеты', () => {
  assert.equal(checkTemplate(RULES, '<Form {f}><Input /><Select options={o} /></Form>', ROUTE), null);
});

test('template: <svelte:element this="form"> — дыра закрыта, this="div" легален', () => {
  assert.ok(checkTemplate(RULES, '<svelte:element this="form">{x}</svelte:element>', ROUTE));
  assert.equal(checkTemplate(RULES, '<svelte:element this="div">{x}</svelte:element>', ROUTE), null);
});

test('source: ручной formProps запрещён вне lib/form', () => {
  const msg = checkSource(RULES, 'const f = { formProps: () => ({ method: "post" }) }', ROUTE);
  assert.ok(msg);
  assert.match(msg, /bind\(/);
  assert.match(msg, /intercept: false/);
  assert.equal(checkSource(RULES, 'export function formProps() {}', '/app/src/lib/form/svelte/bind.svelte.ts'), null);
});

test('source: f.error/f.pending — только перехватчик поля (Field takeover)', () => {
  const widget = '/app/src/content/user/ui/AuthWidget.svelte';
  const msg = checkSource(RULES, 'const f = bound.f.avatar; f.error = { code: "image.bad" }', widget);
  assert.ok(msg);
  assert.match(msg, /takeover/);
  assert.ok(checkSource(RULES, 'f.pending = convert()', '/app/src/routes/(site)/(app)/x/+page.ts'));
  assert.equal(
    checkSource(RULES, '<Field of={bound.f.avatar} takeover={(f) => { f.error = undefined; f.pending = p }} />', widget),
    null,
  );
  assert.equal(
    checkSource(RULES, "import type { FieldTakeover } from '#lib/form/svelte/index.js'\nexport const t: FieldTakeover = (f) => { f.error = undefined }", '/app/src/content/user/photo.ts'),
    null,
  );
  assert.equal(checkSource(RULES, 'f.error = { code: "x" }', '/app/src/components/form/PhotoField.svelte'), null);
  assert.equal(checkSource(RULES, 'if (a.error == b) {}', widget), null);
  assert.equal(checkSource(RULES, '// по справочникам.\npending = build()', '/app/src/server/x.server.ts'), null);
});

test('source: createElement("form") запрещён', () => {
  assert.ok(checkSource(RULES, 'const el = document.createElement("form")', '/app/src/lib/x.ts'));
  assert.equal(checkSource(RULES, 'document.createElement("div")', '/app/src/lib/x.ts'), null);
});

test('source: form-экшены обязаны идти через #lib/form', () => {
  assert.ok(checkSource(RULES, 'export const actions = { default: async () => ({}) }', SERVER));
  assert.equal(
    checkSource(RULES, "import { handleSignup } from './handle.server'\nexport const actions = {}", SERVER),
    null,
  );
  assert.equal(
    checkSource(RULES, "import { createFormHandler } from '#lib/form/server.js'\nexport const actions = {}", SERVER),
    null,
  );
});

test('source: разбор тела маршрутом запрещён, файлом со слоями — разрешён', () => {
  assert.ok(checkSource(RULES, 'const d = await request.formData()', SERVER));
  assert.ok(checkSource(RULES, 'const j = await request.json()', SERVER));
  assert.equal(
    checkSource(
      RULES,
      "import { createFormHandler } from '#lib/form/server.js'\nconst p = await request.clone().formData()",
      '/app/src/routes/(site)/(app)/form/handle.server.ts',
    ),
    null,
  );
});

/* ── адрес: GET читается и пишется только через #lib/address ────────── */

const src = (code, file) => checkSource(RULES, code, file);

test('писатель адреса: нативный history запрещён вне lib/address', () => {
  const msg = src("history.pushState({}, '', '/x?y=1');", '/app/src/components/panel.svelte');
  assert.ok(msg);
  assert.match(msg, /writeAddress/);
  assert.equal(src("history.replaceState({}, '', '/x');", '/app/src/lib/address/sveltekit.ts'), null);
});

test('писатель адреса: pushState/replaceState из $app/navigation запрещены', () => {
  const msg = src("import { pushState } from '$app/navigation';\npushState('/x', {});", '/app/src/components/steps/steps.svelte.ts');
  assert.ok(msg);
  assert.match(msg, /writeAddress/);
  assert.match(msg, /shallow/);
  assert.equal(
    src("import { pushState } from '$app/navigation';", '/app/src/lib/address/sveltekit.ts'),
    null,
  );
});

test('писатель адреса: многострочный импорт тоже ловится', () => {
  const code = "import {\n  goto,\n  replaceState,\n} from '$app/navigation';";
  assert.ok(src(code, '/app/src/routes/x/+page.svelte'));
});

test('чтение адреса: page.url в компонентах запрещён, visibleAddress разрешён', () => {
  const msg = src("const p = page.url.pathname;", '/app/src/components/shell/ui/sidebar/SidebarNav.svelte');
  assert.ok(msg);
  assert.match(msg, /visibleAddress/);
  assert.equal(src("const p = visibleAddress().url.pathname;", '/app/src/components/shell/ui/sidebar/SidebarNav.svelte'), null);
  assert.equal(src("const u = page.url;", '/app/src/lib/modals/cores/sveltekit.ts'), null);
});

test('навигация: goto в библиотеках/компонентах запрещён, у Link/HoldButton и писателя — нет', () => {
  const msg = src("import { goto } from '$app/navigation';\ngoto('/x');", '/app/src/components/demo/DemoPanel.svelte');
  assert.ok(msg);
  assert.match(msg, /writeAddress|Link/);
  assert.equal(src("import { goto } from '$app/navigation';", '/app/src/hooks/links/link.svelte.ts'), null);
  assert.equal(
    src("import { goto } from '$app/navigation';", '/app/src/components/ui/button/HoldButton.svelte'),
    null,
  );
  assert.equal(src("import { goto } from '$app/navigation';", '/app/src/lib/address/sveltekit.ts'), null);
  assert.equal(src("import { goto } from '$app/navigation';\ngoto('/x');", '/app/src/routes/x/+page.svelte'), null);
});

/* ── скан всего дерева ───────────────────────────────────────────────── */

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(svelte|ts|js|mjs)$/.test(e.name) ? [p] : [];
  });
}

test('исходники src: адресные и source-правила соблюдены во ВСЁМ дереве', () => {
  const root = new URL('../src', import.meta.url).pathname;
  const bad = [];
  for (const file of walk(root)) {
    if (/\.test\.ts$|\.spec\.ts$/.test(file)) continue;
    const msg = checkSource(RULES, readFileSync(file, 'utf8'), file);
    if (msg) bad.push(`${file.replace(root + '/', 'src/')}: ${msg.split('\n')[0]}`);
  }
  assert.deepEqual(bad, [], 'нарушения source-правил:\n' + bad.join('\n'));
});

test('src/server: каждый модуль — *.server.ts (кроме явного trusted-origins.ts)', () => {
  const root = new URL('../src/server', import.meta.url).pathname;
  const allowed = new Set(['trusted-origins.ts']);
  const stray = walk(root)
    .filter((file) => /\.(ts|js|mts|mjs)$/.test(file) && !/\.test\.(ts|js|mts|mjs)$/.test(file))
    .map((file) => file.replace(root + '/', 'src/server/'))
    .filter((rel) => !allowed.has(rel.slice('src/server/'.length)) && !/\.server\.(?:ts|js|mts|mjs)$/.test(rel));
  // Соглашение: серверный слой — это `*.server.ts`. Файл без суффикса клиент
  // может импортировать, не заметив, что тянет серверный синглтон (соединение с
  // БД, секреты окружения). Проверка идёт по ВСЕМУ дереву, а не по списку файлов.
  assert.deepEqual(stray, [], 'файлы без суффикса .server: ' + stray.join(', '));
});

test('исходники src: теговые правила (формы и поля) соблюдены во ВСЁМ дереве', () => {
  const root = new URL('../src', import.meta.url).pathname;
  const bad = [];
  for (const file of walk(root)) {
    if (/\.test\.ts$|\.spec\.ts$/.test(file)) continue;
    if (!/\.(svelte|html)$/.test(file)) continue;
    const msg = checkTemplate(RULES, readFileSync(file, 'utf8'), file);
    if (msg) bad.push(`${file.replace(root + '/', 'src/')}: ${msg.split('\n')[0]}`);
  }
  assert.deepEqual(bad, [], 'нарушения теговых правил:\n' + bad.join('\n'));
});

test('исходники src: импортные правила и границы слоёв соблюдены во ВСЁМ дереве', () => {
  const root = new URL('../src', import.meta.url).pathname;
  const bad = [];
  for (const file of walk(root)) {
    if (/\.test\.ts$|\.spec\.ts$/.test(file)) continue;
    for (const spec of collectSpecifiers(readFileSync(file, 'utf8'))) {
      const msg = check(spec, file);
      if (msg) bad.push(`${file.replace(root + '/', 'src/')} <- ${spec}: ${msg.split('\n')[0]}`);
    }
  }
  assert.deepEqual(bad, [], 'нарушения импортных правил:\n' + bad.join('\n'));
});

/* ── защита lib/form: написания-обходы и новые правила полей ── */

test('lib/form: компоненты недоступны любым написанием спецификатора', () => {
  const from = '/app/src/lib/form/svelte/bind.svelte.ts';
  assert.ok(check('#components/ui/index.js', from), '#components/... должен блокироваться');
  assert.ok(check('../../../components/ui/index.js', from), 'относительный должен блокироваться');
  assert.ok(check('#components/form/Field.svelte', from), 'слой полей целиком должен блокироваться');
  assert.equal(check('#components/ui/index.js', '/app/src/content/x.ts'), null, 'приложению ui доступен');
  assert.equal(check('#lib/form/index.js', from), null, 'своя библиотека доступна');
});

test('сырые теги внутри lib/form — только в Form.svelte', () => {
  const tag = '<input type="text" name="x" />';
  assert.ok(checkTemplate(RULES, tag, '/app/src/lib/form/svelte/NewField.svelte'));
  assert.equal(checkTemplate(RULES, tag, '/app/src/lib/form/svelte/Form.svelte'), null);
  assert.ok(checkTemplate(RULES, tag, '/app/src/components/form/TextField.svelte'));
});

test('скрытые поля и рукописные name= объявляет только lib/form', () => {
  const hidden = '<Input type="hidden" name="nonce" value={x} />';
  assert.ok(checkTemplate(RULES, hidden, '/app/src/content/user/ui/AuthWidget.svelte'));
  assert.equal(checkTemplate(RULES, hidden, '/app/src/components/form/HiddenField.svelte'), null);
  const named = '<Input name="nickname" value={x} />';
  assert.ok(checkTemplate(RULES, named, '/app/src/routes/+page.svelte'));
  const bound = '<Select {...v.attrs} name={v.name} />';
  assert.equal(checkTemplate(RULES, bound, '/app/src/routes/demo/+page.svelte'), null);
});
