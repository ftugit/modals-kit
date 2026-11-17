import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Списки сессий: массовый набор — `?/others` (серверный срез по фильтру),
// одиночный отзыв карточки — `?/revoke`. Оба экшена живы; страж не даёт ни
// удалить одиночный отзыв, ни вернуть карточку на массовый набор.
const LIST_ROUTES = [
  'src/sections/user/sessions/load.server.ts',
  'src/sections/user/user-sessions/load.server.ts',
]

test('списки сессий экспортируют живые экшены revoke и others', () => {
  for (const file of LIST_ROUTES) {
    const src = readFileSync(file, 'utf8')
    assert.match(src, /\brevoke\s*:\s*async/, `${file}: нет одиночного actions.revoke`)
    assert.match(src, /\bothers\s*:\s*async/, `${file}: нет массового actions.others`)
  }
})

test('карточка закрывает одну строку экшеном ?/revoke, а не набором ?/others', () => {
  const src = readFileSync('src/modules/user/sessions/svelte/SessionCard.svelte', 'utf8')
  assert.match(src, /\?\/revoke/, 'карточка должна POST-ить на ?/revoke')
  assert.doesNotMatch(src, /\?\/others/, 'карточка не должна использовать массовый набор')
})

test('адрес ?/revoke в UI живёт только там, где экшен revoke реально есть', () => {
  let problems = []
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
  // `?/revoke` legitimately also lives in the WebDAV token screen: there `revoke`
  // is a real action on `/user/config/dav` (see `sections/drive/dav-tokens.server.ts`).
  const allowed = new Set([
    'src/modules/user/sessions/svelte/SessionCard.svelte',
    'src/modules/drive/ui/DriveDavTokens.svelte',
  ])
  problems = problems.filter((p) => !allowed.has(p))
  assert.deepEqual(problems, [])
})
