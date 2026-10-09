import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuard, checkTemplate, checkSource, RULES } from './layer-guard.mjs';

const check = createGuard(RULES);

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
  assert.equal(check('@ark-ui/svelte/combobox', '/app/src/ui/select.svelte'), null);
  assert.equal(check('@ark-ui/svelte/menu', '/app/src/ui/menu.svelte'), null);
});

test('возможности слоя — только в lib/overlay', () => {
  assert.ok(check('@zag-js/focus-trap', '/app/src/ui/primitives/select.svelte'));
  assert.equal(check('@zag-js/focus-trap', '/app/src/lib/overlay/index.ts'), null);
  assert.ok(check('@zag-js/remove-scroll', '/app/src/features/x.ts'));
  assert.ok(check('@zag-js/aria-hidden', '/app/src/features/x.ts'));
});

test('dismissable НЕ запрещён (нужен drawer для no-JS)', () => {
  assert.equal(check('@zag-js/dismissable', '/app/src/ui/shell/use-drawer.ts'), null);
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
  // import(`@ark-ui/svelte/${name}`) — на этапе resolveId это не литерал.
  const computed = '@ark-ui/svelte/' + 'dialog';
  assert.ok(check(computed, '/app/src/features/x.ts'), 'литерал после конкатенации — ловится');
  // но выражение, собранное в рантайме, до resolveId не доходит вовсе:
  assert.equal(check('@ark-ui/svelte/${part}', '/app/src/features/x.ts'), null);
});

/* ── сырые form-теги: только библиотека формы и примитивы полей ──────── */

test('сырой <input> на странице — ошибка, подсказывающая замену', () => {
  const msg = checkTemplate(RULES, '<template><input name="q" /></template>', '/app/src/routes/search/+page.svelte');
  assert.ok(msg, 'должно вернуть ошибку');
  assert.match(msg, /Form.*from '\$lib\/form\/svelte'/s, 'сообщение указывает на <Form>');
  assert.match(msg, /primitives/, 'и на примитивы полей');
});

test('<form>/<input> разрешены в lib/form', () => {
  assert.equal(checkTemplate(RULES, '<form {...attrs}><input /></form>', '/app/src/lib/form/svelte/Form.svelte'), null);
});

test('примитивы полей и виджеты панелей — свои теги законны', () => {
  assert.equal(checkTemplate(RULES, '<input />', '/app/src/lib/ui/primitives/Input.svelte'), null);
  assert.equal(checkTemplate(RULES, '<select></select>', '/app/src/lib/ui/primitives/NativeSelect.svelte'), null);
  assert.equal(checkTemplate(RULES, '<input />', '/app/src/lib/ui/settings/Toggle.svelte'), null);
});

test('оболочка (sidebar) — исключение владельца', () => {
  assert.equal(checkTemplate(RULES, '<input type="checkbox" />', '/app/src/lib/shell/AppShell.svelte'), null);
});

test('node_modules (Ark UI рендерит скрытые input сам) не под проверкой', () => {
  assert.equal(checkTemplate(RULES, '<input />', '/app/node_modules/@ark-ui/svelte/checkbox.svelte'), null);
});

test('<Form /> (компонент, не тег) не задевает правило; тег — различим', () => {
  // имя компонента — с заглавной: это не <form>
  assert.equal(checkTemplate(RULES, '<Form {form}><span /></Form>', '/app/src/routes/x/+page.svelte'), null);
  // строчное — тег
  assert.ok(checkTemplate(RULES, '<form action="/x"><span /></form>', '/app/src/routes/x/+page.svelte'));
});

/* ── lib/form не знает про UI-примитивы ─────────────────────────────── */

test('импорт примитивов внутрь lib/form запрещён', () => {
  assert.ok(check('$lib/ui/primitives', '/app/src/lib/form/svelte/provider.svelte'));
  assert.ok(check('$lib/ui/settings', '/app/src/lib/form/svelte/x.svelte'));
});

test('импорт примитивов разрешён всем, кто вне lib/form', () => {
  assert.equal(check('$lib/ui/primitives', '/app/src/routes/form/+page.svelte'), null);
  assert.equal(check('$lib/ui/primitives', '/app/src/lib/ui/demo/form/ui/Field.svelte'), null);
  // и другие $lib/ui-модули form-библиотеку не касаются
  assert.equal(check('$lib/ui/cn', '/app/src/lib/form/svelte/config.ts'), null);
});

test('template: <NativeSelect> вне кита блокируется с подсказкой enhanced Select', () => {
  const msg = checkTemplate(RULES, '<div><NativeSelect name="s" /></div>', '/app/src/routes/demo/+page.svelte');
  assert.match(msg, /только внутри кита/);
  assert.match(msg, /\$lib\/ui\/primitives/);
});

test('template: <NativeSelect /> самозакрытый тоже блокируется; enhanced <Select /> — нет', () => {
  assert.notEqual(checkTemplate(RULES, '<NativeSelect />', '/app/src/features/x.svelte'), null);
  assert.equal(checkTemplate(RULES, '<Select options={opts} />', '/app/src/features/x.svelte'), null);
});

test('template: кит собирает носитель сам — settings и shell легальны', () => {
  assert.equal(checkTemplate(RULES, '<NativeSelect {name}/>', '/app/src/lib/ui/settings/Select.svelte'), null);
  assert.equal(checkTemplate(RULES, '<NativeSelect {name}/>', '/app/src/lib/shell/sidebar.svelte'), null);
});

/* ── обход lib/form (добавлено 2026-10-09 после разбора дыр узора) ────── */

const ROUTE = '/app/src/routes/x/+page.svelte';
const SERVER = '/app/src/routes/x/+page.server.ts';

test('template: самозакрытый и закрывающий form-теги ловятся', () => {
  assert.ok(checkTemplate(RULES, '<form/>', ROUTE), '<form/>');
  assert.ok(checkTemplate(RULES, '<input/>', ROUTE), '<input/>');
  assert.ok(checkTemplate(RULES, '<span></span></form>', ROUTE), '</form>');
});

test('template: ВЕРХНИЙ регистр — те же теги, ловится (правило <dialog> умеет, и это умеет)', () => {
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
  assert.ok(msg, 'обнаружен');
  assert.match(msg, /bind\(\)/, 'сообщение указывает на bind');
  assert.match(msg, /intercept: false/, 'сообщение предлагает легальный режим без перехвата');
  assert.equal(checkSource(RULES, 'export function formProps() {}', '/app/src/lib/form/svelte/bind.svelte.ts'), null);
});

test('source: createElement("form") запрещён', () => {
  assert.ok(checkSource(RULES, 'const el = document.createElement("form")', '/app/src/lib/x.ts'));
  assert.equal(checkSource(RULES, 'document.createElement("div")', '/app/src/lib/x.ts'), null);
});

test('source: form-экшены обязаны идти через $lib/form', () => {
  assert.ok(checkSource(RULES, 'export const actions = { default: async () => ({}) }', SERVER));
  assert.equal(
    checkSource(RULES, "import { handleSignup } from '$lib/ui/demo/form/handle'\nexport const actions = {}", SERVER),
    null,
    'обёртка над слоями — легальный путь',
  );
  assert.equal(
    checkSource(RULES, "import { createFormHandler } from '$lib/form/server'\nexport const actions = {}", SERVER),
    null,
  );
});

test('source: разбор тела маршрутом запрещён, файдом со слоями — разрешён', () => {
  assert.ok(checkSource(RULES, 'const d = await request.formData()', SERVER));
  assert.ok(checkSource(RULES, 'const j = await request.json()', SERVER));
  assert.equal(
    checkSource(
      RULES,
      "import { createFormHandler } from '$lib/form/server'\nconst p = await request.clone().formData()",
      '/app/src/lib/ui/demo/form/handle.ts',
    ),
    null,
    'probe до слоёв остаётся легальным: файл знает про createFormHandler',
  );
});
