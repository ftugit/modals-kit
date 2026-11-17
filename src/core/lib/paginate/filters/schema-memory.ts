/**
 * Память схем фильтров на время жизни вкладки (решение владельца): схема,
 * однажды пришедшая в браузер, живёт в оперативной памяти, пока человек не
 * ушёл с сайта или не перезагрузил страницу. Не localStorage: перезагрузка —
 * законный способ получить свежую схему, а хранить чужие справочники между
 * визитами незачем.
 *
 * Зачем: серверная загрузка страницы отдаёт схему только при полной отрисовке
 * (её нужна разметка без JS и гидратация); при переходах внутри сайта схема
 * берётся отсюда, а не едет заново с каждой страницей. Живая проверка в
 * браузере идёт по схеме из памяти; окончательно выбор проверяет сервер по
 * своей текущей схеме, поэтому устаревшая схема в долгоживущей вкладке безвредна.
 *
 * Ключ — `schema.source`: так помнится схема любого источника, а не одного.
 * Клиент без JS сохранить ничего не может — ему схема приходит с каждой страницей.
 *
 * На сервере память выключена: переменная модуля там общая для ВСЕХ запросов
 * и пользователей, а схема одного запроса не должна становиться ответом другому.
 */
import { BROWSER } from 'esm-env'
import type { CatalogFilterSchema } from './schema'

/** Память схем фильтров во вкладке: `remember`/`recall` по источнику. */
export interface CatalogFilterSchemaMemory {
  /** Запомнить схему под её `source` (повторная — заменяет прежнюю). */
  remember(schema: CatalogFilterSchema): void
  /** Схема источника из памяти; `null` — её здесь нет. */
  recall(source: string): CatalogFilterSchema | null
  /** Забыть все схемы (тесты; приложению не нужно — память живёт до перезагрузки). */
  clear(): void
}

/**
 * Память схем. `enabled` — включена ли она вообще: по умолчанию только в
 * браузере (`BROWSER` из esm-env), на сервере `remember` ничего не делает,
 * а `recall` всегда отвечает `null`.
 * @param enabled Включить память (по умолчанию — только в браузере).
 * @returns Память с методами `remember` / `recall` / `clear`.
 */
export function createCatalogFilterSchemaMemory(enabled: boolean = BROWSER): CatalogFilterSchemaMemory {
  const schemas = new Map<string, CatalogFilterSchema>()
  return {
    remember(schema) {
      if (enabled) schemas.set(schema.source, schema)
    },
    recall(source) {
      return enabled ? (schemas.get(source) ?? null) : null
    },
    clear() {
      schemas.clear()
    },
  }
}

/** Общая память вкладки: одна на приложение, как и сама вкладка. */
export const catalogFilterSchemas: CatalogFilterSchemaMemory = createCatalogFilterSchemaMemory()
