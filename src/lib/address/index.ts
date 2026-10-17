/**
 * `#lib/address` — один писатель адреса на приложение (ядро без фреймворка) и
 * связки записей истории «слой → запись под ним». Адаптер SvelteKit —
 * `#lib/address/sveltekit.js`; под другой роутер пишется свой адаптер из четырёх
 * функций `AddressWriterDeps` (`read`, `commit`, `hash`, `traverse`).
 */
export * from './core'
export * from './keys'
export * from './layer-links'
