import { describe, expect, it } from 'vitest'
import { createCatalogFilterSchemaMemory } from './schema-memory'
import type { CatalogFilterSchema } from './catalog-filter'

const schema = (source: string, builtAt: string): CatalogFilterSchema => ({
  source, version: 1, builtAt, fields: [{ key: 'kind', label: 'Тип', type: 'select', options: [{ value: 'tv', label: 'TV' }] }],
})

describe('память схем вкладки', () => {
  it('помнит схему по source, повторная заменяет прежнюю, clear забывает', () => {
    const memory = createCatalogFilterSchemaMemory(true)
    expect(memory.recall('shikimori')).toBeNull()
    memory.remember(schema('shikimori', '2026-10-12T10:00:00.000Z'))
    memory.remember(schema('rm', '2026-10-12T10:00:00.000Z'))
    memory.remember(schema('shikimori', '2026-10-12T11:00:00.000Z'))
    expect(memory.recall('shikimori')?.builtAt).toBe('2026-10-12T11:00:00.000Z')
    expect(memory.recall('rm')?.source).toBe('rm')
    memory.clear()
    expect(memory.recall('shikimori')).toBeNull()
  })

  it('выключенная (сервер) ничего не хранит: схема одного запроса не станет ответом другому', () => {
    const memory = createCatalogFilterSchemaMemory(false)
    memory.remember(schema('shikimori', '2026-10-12T10:00:00.000Z'))
    expect(memory.recall('shikimori')).toBeNull()
  })

  it('по умолчанию на сервере (тесты в node) память выключена', () => {
    const memory = createCatalogFilterSchemaMemory()
    memory.remember(schema('shikimori', '2026-10-12T10:00:00.000Z'))
    expect(memory.recall('shikimori')).toBeNull()
  })
})
