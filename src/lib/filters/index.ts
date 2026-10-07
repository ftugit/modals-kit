/**
 * Фильтры каталога: схема, значения, связки, адрес, форма.
 *
 * Модуль framework-free и изоморфный: его импортируют и серверная зона схемы,
 * и клиентская форма, и транспорт источника. Здесь НЕТ знаний о конкретном
 * каталоге — источник приходит схемой (`CatalogFilterSchema`), как и в каноне
 * (`ftugit/SolidHono@shiki-final`, `src/lib/search/catalog-filter.ts`).
 */
export * from './catalog-filter'
export * from './rules'
