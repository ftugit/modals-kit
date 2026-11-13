import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSource, checkDir } from './journal-path-guard.mjs';

test('ловит вшитый литерал адреса журнала', () => {
  const src = `<Button href="/sessions" data-testid="seed-users-sessions-open">Все сессии</Button>`
  const problems = checkSource(src, 'x.svelte');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /sessionsJournalRoute/);
});

test('ловит свой разбор пути журнала на месте', () => {
  const src = `const journal = /^\\/sessions(?:\\/|$)/.test(fromUrl.pathname)`
  const problems = checkSource(src, 'y.ts');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /sessionsFiltersTarget/);
});

test('комментарий и осознанное отклонение не считаются кодом', () => {
  assert.deepEqual(checkSource('// журнал — это `/sessions`', 'x.ts'), []);
  assert.deepEqual(checkSource("const a = '/sessions' // journal-path-ok: тест стража", 'x.ts'), []);
});

test('обычный код не задевается', () => {
  assert.deepEqual(checkSource("import { sessionsJournalRoute } from '../routes.js'", 'x.ts'), []);
  assert.deepEqual(checkSource('const href = sessionsJournalRoute.href()', 'x.ts'), []);
});

test('ловит вшитый адрес списка своих устройств', () => {
  const problems = checkSource("const href = '/user/sessions'", 'x.ts')
  assert.equal(problems.length, 1)
  assert.match(problems[0], /userSessionsRoute/)
})

test('ловит шаблон чужого списка вместо реестра', () => {
  const problems = checkSource('const href = `/user/${uid}/sessions`', 'x.ts')
  assert.equal(problems.length, 1)
  assert.match(problems[0], /userAccountSessionsRoute/)
})

test('в проекте нет нарушений', () => {
  assert.deepEqual(checkDir('src'), []);
});
