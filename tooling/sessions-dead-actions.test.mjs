import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Списки сессий: массовый набор — `?/others` (серверный срез по фильтру),
// одиночный отзыв карточки — `?/revoke`. Оба экшена живы; страж не даёт ни
// удалить одиночный отзыв, ни вернуть карточку на массовый набор.
const LIST_ROUTES = [
  'src/routes/(site)/(app)/user/sessions/+page.server.ts',
  'src/routes/(site)/(app)/user/[id=uuid]/sessions/+page.server.ts',
]

test('списки сессий экспортируют живые экшены revoke и others', () => {
  for (const file of LIST_ROUTES) {
    const src = readFileSync(file, 'utf8')
    assert.match(src, /\brevoke\s*:\s*async/, `${file}: нет одиночного actions.revoke`)
    assert.match(src, /\bothers\s*:\s*async/, `${file}: нет массового actions.others`)
  }
})

test('карточка закрывает одну строку экшеном ?/revoke, а не набором ?/others', () => {
  const src = readFileSync('src/content/user/ui/SessionCard.svelte', 'utf8')
  assert.match(src, /\?\/revoke/, 'карточка должна POST-ить на ?/revoke')
  assert.doesNotMatch(src, /\?\/others/, 'карточка не должна использовать массовый набор')
})

test('адрес ?/revoke в UI живёт только в карточке', () => {
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
  assert.deepEqual(problems, ['src/content/user/ui/SessionCard.svelte'])
})
