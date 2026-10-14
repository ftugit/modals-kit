/**
 * Фильтры каталога: схема, значения, связки, адрес, форма.
 *
 * Модуль framework-free и изоморфный: его импортируют и серверная зона схемы,
 * и клиентская форма, и транспорт источника. Здесь НЕТ знаний о конкретном
 * каталоге — источник приходит схемой (`CatalogFilterSchema`), как и в каноне
 * (`ftugit/SolidHono@shiki-final`, `src/lib/search/catalog-filter.ts`).
 */
export * from './schema'
export * from './url'
// form.ts — списком: `ruleCondition` нужна rules.ts, но это не API пакета
export {
  CATALOG_FILTER_MODE_LABEL,
  CATALOG_FILTER_BOUND_LABEL,
  compileCatalogFilterSchema,
  stripDefaultCatalogFilterValues,
  catalogFilterInitialState,
  catalogFilterFormData,
} from './form'
export * from './rules'
export * from './view'
export * from './schema-memory'
