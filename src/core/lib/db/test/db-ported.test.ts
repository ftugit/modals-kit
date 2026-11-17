import { it } from 'vitest'

/**
 * Перенесённые проверки источника — скрипты с top-level await: у них общий
 * прогон PGlite/PG и общий `try/finally`. Поэтому один скрипт = один `it`,
 * а имена групп печатает сам скрипт.
 */
const scripts: [string, string][] = [
  ['db-lib: перенесённые проверки источника', './ported/db-lib.script.ts'],
  ['db-hardening: устойчивость отказов', './ported/db-hardening.script.ts'],
  ['db-followup: дополнения переноса', './ported/db-followup.script.ts'],
]

for (const [name, path] of scripts) it(name, async () => { await import(path) }, 180_000)
