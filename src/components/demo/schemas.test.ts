// Скан ВСЕХ схем демо-панелей проекта — защита на сборке, а не в рантайме.
//
//  1. Каждая схема лежит в `demo-schema.ts` рядом со страницей и импортируется
//     здесь вне приложения: `defineDemoPanel` проверяет данные при импорте,
//     поэтому неверная схема роняет этот тест (и `npm test`/CI), а не страницу
//     у пользователя.
//  2. `defineDemoPanel(` в любом другом файле `src/routes` — ошибка: иначе схема
//     объявляется мимо скана, и «защита при сборке» становится обещанием.
import { describe, expect, it } from 'vitest'
import { demoPanelDefects } from './define'

type SchemaModule = { demoPanelSchema?: unknown }

const schemas = import.meta.glob('/src/routes/**/demo-schema.ts', {
  eager: true,
}) as Record<string, SchemaModule>

const sources = import.meta.glob('/src/routes/**/*.{ts,svelte}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('схемы демо-панелей: скан src/routes', () => {
  it('маршруты для сканирования нашлись (скан не пустой)', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(0)
  })

  it('каждая установленная схема экспортирует demoPanelSchema и проходит проверку', () => {
    for (const [file, mod] of Object.entries(schemas)) {
      expect(mod.demoPanelSchema, `${file}: нужен экспорт demoPanelSchema`).toBeTruthy()
      expect(demoPanelDefects(mod.demoPanelSchema), file).toEqual([])
    }
  })

  it('defineDemoPanel вызывают ТОЛЬКО в demo-schema.ts', () => {
    const offenders = Object.entries(sources)
      .filter(([file, src]) => src.includes('defineDemoPanel(') && !file.endsWith('/demo-schema.ts'))
      .map(([file]) => file)
    expect(offenders).toEqual([])
  })
})
