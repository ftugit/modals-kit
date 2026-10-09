/**
 * Боевой прогон аудита документации слоя.
 *
 * Сами правила и их разбор — в `tooling/db-docs.mjs` (там же и юнит-тесты на
 * игрушечных входах). Здесь аудит получает настоящие входы: исходники слоя,
 * реальные `FAILURE_STATUS` / `conservativeLimits` / `splitSqlStatements` (не
 * перепечатанные значения!), README, PORTING, docs/ и все файлы приложения,
 * которые слой упоминают.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { it } from 'vitest'
import { auditDocs, DB_ROOT, ENTRIES, formatProblems } from '../../../../tooling/db-docs.mjs'
import { conservativeLimits } from'../types'
import { FAILURE_STATUS, splitSqlStatements } from'../sveltekit/index'

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((e) => {
    const p = join(dir, e)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })

const read = (p: string) => readFileSync(p, 'utf8')

it('документация слоя $lib/db актуальна против кода', () => {
  // исходники слоя: и с расширением, и без — re-export вида `export * from'../errors'`
  const sources: Record<string, string> = {}
  for (const file of walk(DB_ROOT)) {
    if (!file.endsWith('.ts') || /\.d\.ts$/.test(file)) continue
    const rel = relative(DB_ROOT, file)
    const text = read(file)
    sources[rel] = text
    sources[rel.replace(/\.ts$/, '')] = text
  }

  const appFiles = walk('src')
    .filter((f) => /\.(ts|svelte)$/.test(f) && !f.startsWith(`${DB_ROOT}/`))
    .map((f) => ({ file: f, text: read(f) }))
    .filter(({ text }) => /lib\/db|kit-db/.test(text))
  assert.ok(appFiles.length >= 5, `аудит должен видеть потребителей слоя, а видит ${appFiles.length}`)

  const groups: [string, number, boolean?][] = [
    ['db-structure', (read(`${DB_ROOT}/test/db-structure.test.ts`).match(/^check\(/gm) ?? []).length, false],
    ['db-port-specific', (read(`${DB_ROOT}/test/db-port-specific.test.ts`).match(/^test\(/gm) ?? []).length, false],
    // у перенесённых проверок часть групп регистрируется только на native PG (A11),
    // поэтому допустим разброс [n-1, n]: документация обязана назвать честное число
    ['db-lib', countCalls(`${DB_ROOT}/test/ported/db-lib.script.ts`), true],
    ['db-hardening', countCalls(`${DB_ROOT}/test/ported/db-hardening.script.ts`), true],
    ['db-followup', countCalls(`${DB_ROOT}/test/ported/db-followup.script.ts`), true],
  ]

  const problems = auditDocs({
    readme: read(`${DB_ROOT}/README.md`),
    porting: read(`${DB_ROOT}/PORTING.md`),
    extraDocs: [
      ['TRANSPORTS', read(`${DB_ROOT}/docs/TRANSPORTS.md`)],
      ['ACL-DESIGN', read(`${DB_ROOT}/docs/ACL-DESIGN.md`)],
    ],
    sources,
    appFiles,
    limits: conservativeLimits as unknown as Record<string, number>,
    status: FAILURE_STATUS as unknown as Record<string, number>,
    groups,
    splitSqlStatements,
    migrations: [
      ['001-db-probe.sql', read(`${DB_ROOT}/migrations/001-db-probe.sql`)],
      ['002-db-probe-page-index.sql', read(`${DB_ROOT}/migrations/002-db-probe-page-index.sql`)],
    ],
    expectedStatements: { '001-db-probe.sql': 5 },
    exists: (rel) => existsSync(rel),
  })

  assert.equal(problems.length, 0, formatProblems(problems))
  // карта entry-поинтов обязана покрывать весь публичный слой: новый экспорт,
  // не внесённый в ENTRIES, молча выпадал бы из аудита
  for (const file of Object.values(ENTRIES)) assert.ok(sources[file], `ENTRIES указывает на ${file}, которого нет в дереве`)
})

function countCalls(file: string): number {
  const text = readFileSync(file, 'utf8')
  return (text.match(/\btest\(\s*["']/g) ?? []).length
}
