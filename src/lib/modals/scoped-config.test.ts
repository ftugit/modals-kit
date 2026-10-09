// Скоупы настроек хоста (решение оператора 2026-10-10): демо-страница обязана
// влиять только на свои модалки. С `configScope` запись `configure` уходит в
// слайс активного пути, база (пропсы хоста, `configureBase`) остаётся общей,
// а чтение на другом пути слайса не видит. Без `configScope` — прежнее
// поведение (одна база, любые записи в неё).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createModals } from './create'
import { memoryCore } from './cores/memory'
import { DEFAULT_HOST_CONFIG } from './types'

test('scoped config: слайс страницы видим только в своём скоупе', () => {
  let route = '/modals'
  const modals = createModals(memoryCore(), { tailCount: 3, configScope: () => route })

  modals.configure({ defaultMobile: 'left' })
  assert.equal(modals.config.defaultMobile, 'left')
  assert.deepEqual(modals.store.state.hostConfigBy['/modals'], { defaultMobile: 'left' })
  assert.equal(modals.store.state.hostConfig.defaultMobile, DEFAULT_HOST_CONFIG.defaultMobile)

  // Уход на другой путь — база без примесей; слайс живёт, но не действует.
  route = '/paginator'
  modals.setScope(route)
  assert.equal(modals.config.defaultMobile, DEFAULT_HOST_CONFIG.defaultMobile)

  // Пропсы хоста пишутся в базу и видимы всем…
  modals.configureBase({ defaultMobile: 'top' })
  assert.equal(modals.config.defaultMobile, 'top')
  // …а в скоупе демки поверх базы по-прежнему её настройка.
  route = '/modals'
  modals.setScope(route)
  assert.equal(modals.config.defaultMobile, 'left')
})

test('без configScope поведение не меняется: configure пишет в базу', () => {
  const modals = createModals(memoryCore(), { tailCount: 2 })
  modals.configure({ tailCount: 9 })
  assert.equal(modals.config.tailCount, 9)
  assert.deepEqual(modals.store.state.hostConfigBy, {})
})
