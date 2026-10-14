/**
 * Фильтры каталога: схема, значения, связки, адрес, параметры формы.
 *
 * Модуль framework-free и изоморфный: его импортируют и серверная зона схемы,
 * и клиентская форма, и транспорт источника. Здесь НЕТ знаний о конкретном
 * каталоге — источник приходит схемой (`CatalogFilterSchema`), как и в каноне
 * (`ftugit/SolidHono@shiki-final`, `src/lib/search/catalog-filter.ts`).
 */
export * from './schema'
export * from './url'
// form.ts — списком: `ruleCondition`/`disableRulesFor` нужны соседям, но это не API пакета
export { stripDefaultCatalogFilterValues, catalogFilterFormData, catalogFilterPolicy } from './form'
export * from './params'
export * from './rules'
export * from './view'
export * from './schema-memory'
