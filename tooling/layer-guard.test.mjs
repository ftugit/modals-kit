import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuard, RULES } from './layer-guard.mjs';

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
