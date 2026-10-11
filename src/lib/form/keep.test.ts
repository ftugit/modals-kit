import { afterEach, expect, test, vi } from 'vitest'

// Режим берётся из esm-env (C7), а не из import.meta.env: его подставляет только Vite.
async function keepWith(dev: boolean) {
  vi.resetModules()
  vi.doMock('esm-env', () => ({ DEV: dev, BROWSER: false, NODE: true }))
  return (await import('./keep')).keep
}

afterEach(() => { vi.doUnmock('esm-env'); vi.restoreAllMocks() })

test('то же содержимое повторно — не конфликт ни в каком режиме', async () => {
  for (const dev of [true, false]) {
    const keep = await keepWith(dev)
    const map = new Map<string, number>()
    const v = 1
    keep(map, 'k', v, 'правило'); keep(map, 'k', v, 'правило')
    expect(map.get('k')).toBe(1)
  }
})

test('сборка (DEV=false): другое содержимое под тем же ключом — ошибка', async () => {
  const keep = await keepWith(false)
  const map = new Map<string, object>([['k', {}]])
  expect(() => keep(map, 'k', {}, 'правило')).toThrow(/уже объявлен с другим содержимым/)
})

test('разработка (DEV=true): замена с предупреждением', async () => {
  const keep = await keepWith(true)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const next = {}
  const map = new Map<string, object>([['k', {}]])
  keep(map, 'k', next, 'правило')
  expect(map.get('k')).toBe(next)
  expect(warn).toHaveBeenCalledOnce()
})
