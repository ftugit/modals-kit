import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBodies, checkSource } from './load-url-guard.mjs';

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
