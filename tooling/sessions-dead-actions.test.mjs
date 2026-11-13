import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Списки сессий закрывают набор экшеном `?/others`; одиночный `?/revoke` списков
// был мёртв (карточка и список используют набор). Страж не даёт вернуть его ни
// как экшен роута, ни как адрес в UI.
const LIST_ROUTES = [
  'src/routes/(site)/(app)/user/sessions/+page.server.ts',
  'src/routes/(site)/(app)/user/[id=uuid]/sessions/+page.server.ts',
]

test('списки сессий не экспортируют мёртвый экшен revoke', () => {
  for (const file of LIST_ROUTES) {
    const src = readFileSync(file, 'utf8')
    assert.doesNotMatch(src, /\brevoke\s*:\s*async/, `${file}: мёртвый actions.revoke`)
  }
})

test('адрес ?/revoke не вшит в UI сессий', () => {
  const problems = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) { walk(path); continue }
      if (!/\.(ts|svelte)$/.test(name) || /\.test\./.test(name)) continue
      const src = readFileSync(path, 'utf8')
      if (src.includes('?/revoke')) problems.push(path)
    }
  }
  walk('src')
  assert.deepEqual(problems, [])
})
