import { test } from 'vitest'
import assert from 'node:assert/strict'
// Таблица роутов — рантайм-проверка «битой ссылки» (осмотр 1.10-2, №30).
// Матчер чистый: список файлов роутов приходит параметром, как в оригинале
// FastEdgeApp получал routes от приложения.
import { makeRouteResolves, routePattern } from './routes'

test('routePattern: корень, обычный роут, параметр, group, rest', () => {
  const root = routePattern('/src/routes/+page.svelte')
  assert.equal(root.test('/'), true)
  assert.equal(root.test('/x'), false)

  assert.equal(routePattern('/src/routes/modals/+page.svelte').test('/modals'), true)

  const card = routePattern('/src/routes/cards/[id]/+page.svelte')
  assert.equal(card.test('/cards/7'), true)
  assert.equal(card.test('/cards'), false)
  assert.equal(card.test('/cards/7/x'), false)
  assert.equal(card.test('/cardsx/7'), false)

  // group-каталог в адрес не попадает
  assert.equal(routePattern('/src/routes/(app)/modals/+page.svelte').test('/modals'), true)

  // [...rest] — ноль и больше сегментов
  const rest = routePattern('/src/routes/x/[...rest]/+page.svelte')
  assert.equal(rest.test('/x'), true)
  assert.equal(rest.test('/x/a/b'), true)
  assert.equal(rest.test('/x/'), true)
  assert.equal(rest.test('/y'), false)
})

test('makeRouteResolves: внешние адреса истинны, ?/# отбрасываются, битые — ложь', () => {
  const resolves = makeRouteResolves(['/src/routes/+page.svelte', '/src/routes/cards/[id]/+page.svelte'])
  // внешний адрес — не наш вопрос, как matchPath оригинала
  assert.equal(resolves('https://example.com/x'), true)
  assert.equal(resolves('//cdn.example.com/x'), true)
  assert.equal(resolves('mailto:a@b.c'), true)
  // запрос и фрагмент не влияют
  assert.equal(resolves('/cards/501?slow=1'), true)
  assert.equal(resolves('/cards/501#frag'), true)
  // пустой путь — корень
  assert.equal(resolves('?modal=card'), true)
  assert.equal(resolves('/'), true)
  // битые адреса
  assert.equal(resolves('/no-such-page/1'), false)
  assert.equal(resolves('/cards/1/extra'), false)
})
