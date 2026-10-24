import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadBodies, checkSource, checkDir } from './load-url-guard.mjs';

test('ловит event.request.url в теле load', () => {
  const src = `export const load: PageServerLoad = async (event) => {
  const url = new URL(event.request.url)
  return { step: url.searchParams.get('step') }
}`
  const problems = checkSource(src, 'x.ts');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /event\.url/);
  assert.match(problems[0], /мёртвый шаг/);
});

test('не задевает экшен с event.request.url', () => {
  const src = `export const actions = {
  default: async (event) => {
    const next = new URL(event.request.url).searchParams.get('next')
    return { next }
  },
}`
  assert.deepEqual(checkSource(src, 'x.ts'), []);
});

test('load с event.url чист', () => {
  const src = `export const load = async (event) => {
  const url = event.url
  return { step: url.searchParams.get('step') }
}`
  assert.deepEqual(checkSource(src, 'x.ts'), []);
});

test('файл с чистым load и грязным экшеном чист', () => {
  const src = `export const load = async (event) => {
  return { step: event.url.searchParams.get('step') }
}

export const actions = {
  default: async (event) => {
    const u = new URL(event.request.url)
    return {}
  },
}`
  assert.deepEqual(checkSource(src, 'x.ts'), []);
});

test('layout тоже под правилом', () => {
  const src = `export const layout: LayoutServerLoad = async (event) => {
  return { path: event.request.url }
}`
  assert.equal(checkSource(src, 'x.ts').length, 1);
});

test('скобки и строки в теле не обрывают разбор', () => {
  const src = `export const load = async (event) => {
  // комментарий с } и { внутри
  const s = 'текст с } скобкой'
  const t = \`шаблон с { и }\`
  /* блок с event.request.url в комментарии — не код */
  return { s, t, step: event.url.searchParams.get('step') }
}`
  const bodies = loadBodies(src);
  assert.equal(bodies.length, 1);
  assert.ok(bodies[0].body.includes('searchParams'));
  assert.deepEqual(checkSource(src, 'x.ts'), []);
});

test('отлов не зависит от положения внутри тела (после строк и шаблонов)', () => {
  const src = `export const load = async (event) => {
  const a = '}{' 
  const b = event.request.url
  return { a, b }
}`
  assert.equal(checkSource(src, 'x.ts').length, 1);
});

/* ── боевой прогон по реальному каталогу ─────────────────────────────── */

// Юнит-часть ниже держала правило честным, но САМ проект не проверялся:
// живой блок `load-url-guard.mjs` срабатывает по `process.argv[1]`, а в
// `node --test tooling/` это файл теста — то есть гейт «в проекте нет
// `event.request.url` в load» не запускался никогда. Ошибка того же класса,
// что мёртвое правило: проверка есть, а нарушение пройдёт молча.
test('в проекте нет чтения event.request.url в load', () => {
  const problems = checkDir(new URL('../src/routes', import.meta.url).pathname)
  assert.deepEqual(problems, [], problems.join('\n'))
})

test('гейт не фиктивен: серверные load/layout в проекте существуют', () => {
  // Если бы `checkDir` обходил пустой каталог, предыдущий тест был бы пустым.
  const found = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.server\.ts$/.test(name) && /^\+(page|layout)/.test(name)) found.push(path)
    }
  }
  walk(new URL('../src/routes', import.meta.url).pathname)
  assert.ok(found.length > 0, 'не найдено ни одного +*.server.ts')
})
