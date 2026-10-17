/** Конфиг модуля: умолчание, переопределение по области, валидация. */
import { describe, expect, test } from 'vitest'
import { memoryStore } from '#lib/cache/index.js'
import { createUserConfig, defaults } from './config.js'

const make = () => createUserConfig(memoryStore())

describe('настройки модуля пользователя', () => {
  test('без переопределений — значения по умолчанию', async () => {
    const cfg = make()
    await expect(cfg.get('accessTtlSec')).resolves.toBe(3600)
    await expect(cfg.get('deviceTtlSec')).resolves.toBe(60 * 60 * 24 * 365)
    await expect(cfg.get('sessionRecreate')).resolves.toBe('update')
  })

  test('настройка переопределяет умолчание — в своей области', async () => {
    const cfg = make()
    await cfg.set('accessTtlSec', 7200, 'user:abc')
    await expect(cfg.get('accessTtlSec', 'user:abc')).resolves.toBe(7200)
    await expect(cfg.get('accessTtlSec', 'user:другой')).resolves.toBe(3600)
    await expect(cfg.get('accessTtlSec')).resolves.toBe(3600)
  })

  test('глобальная область видна только там, где её спросили', async () => {
    const cfg = make()
    await cfg.set('sessionRecreate', 'strict')
    await expect(cfg.get('sessionRecreate')).resolves.toBe('strict')
    await expect(cfg.get('sessionRecreate', 'user:abc')).resolves.toBe('update')
  })

  test('reset возвращает умолчание', async () => {
    const cfg = make()
    await cfg.set('deviceTtlSec', 1, 'device:jti')
    await cfg.reset('deviceTtlSec', 'device:jti')
    await expect(cfg.get('deviceTtlSec', 'device:jti')).resolves.toBe(60 * 60 * 24 * 365)
  })

  test('неизвестный ключ и неверный тип — ошибка', async () => {
    const cfg = make()
    await expect(cfg.set('нет_такого' as 'accessTtlSec', 1)).rejects.toThrow()
    await expect(cfg.set('accessTtlSec', 'час' as unknown as number)).rejects.toThrow()
    await expect(cfg.set('sessionRecreate', 'банан' as 'update')).rejects.toThrow()
    await expect(cfg.set('nicknameForbidden', ['x'])).resolves.toBeUndefined()
  })

  test('список запрещённых никнеймов меняется', async () => {
    const cfg = make()
    expect(defaults.nicknameForbidden.length).toBeGreaterThan(0)
    await cfg.set('nicknameForbidden', ['root', 'vasya-admin'])
    await expect(cfg.get('nicknameForbidden', 'global')).resolves.toEqual(['root', 'vasya-admin'])
  })
})
