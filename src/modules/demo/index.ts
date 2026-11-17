/**
 * Витрина демо-модуля: универсальная панель переехала в ядро
 * (`#core/ui/panel`), потому что на ней построена панель настроек пагинатора
 * ядра. Модуль реэкспортирует её для демо-страниц и держит только своё
 * (хранилище cookie-vault и т.п.).
 */
export { default as CookieVault } from './CookieVault.svelte'
export * from '#core/ui/panel/index.js'
