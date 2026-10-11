/**
 * probe: что реально генерирует UnoCSS под НАСТОЯЩИЙ конфиг проекта.
 *
 * Конфиг (`unocss.config.ts`) загружается тем же загрузчиком, что и у Vite
 * (`runnerImport`): TypeScript читается без своей копии темы и без требований к
 * версии Node. Копия раньше расходилась с конфигом — шорткатов в ней не было, и
 * проба ложно печатала «nav-pill НЕ сгенерировано» (C15). Сам конфиг не меняется:
 * проба только печатает CSS по кандидатам, без preflight.
 * https://vite.dev/guide/api-javascript#runnerimport
 *
 *   node tooling/uno-probe.mjs 'z-200' 'data-[starting-style]:opacity-0' nav-pill ...
 */
import { fileURLToPath } from 'node:url'
import { createGenerator } from '@unocss/core'
import { runnerImport } from 'vite'

const configPath = fileURLToPath(new URL('../unocss.config.ts', import.meta.url))
const { module } = await runnerImport(configPath)
const uno = await createGenerator(module.default)

const tests = process.argv.slice(2)
const out = await uno.generate(tests.join(' '), { preflights: false })
console.log(out.css)
const missing = tests.filter((t) => !out.matched.has(t))
if (missing.length) console.log('\n/* НЕ сгенерировано: ' + missing.join(' | ') + ' */')
