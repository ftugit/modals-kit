import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  RUNTIME_INJECTED,
  SCANNED_DIRS,
  SCANNED_EXT,
  SCANNED_FILES,
  auditEnvDocs,
  collectEnvNames,
  documentedKeys,
  formatProblems,
} from './env-docs.mjs'

/* ── разбор чтения окружения ─────────────────────────────────────────── */

test('collectEnvNames видит все три формы и отбрасывает injected', () => {
  const text = [
    'const s = env("DB_CURSOR_SECRET")',
    'if (!process.env.DATABASE_URL) throw new Error("no url")',
    'const v = import.meta.env.DEV',
    'const { DB_POOL_MAX, noise } = process.env',
  ].join('\n')
  assert.deepEqual(collectEnvNames(text), ['DATABASE_URL', 'DB_CURSOR_SECRET', 'DB_POOL_MAX'])
  assert.ok(RUNTIME_INJECTED.has('DEV'), 'DEV должен быть в исключениях')
})

test('документируемый ключ — только строка КЛЮЧ=, комментарий не считается', () => {
  const example = ['# KIT_TRUSTED_ORIGINS=пример в комментарии\nKIT_TRUSTED_ORIGINS=\nDATABASE_DIR=\n# DATABASE_URL=\n'
  ].join('')
  assert.deepEqual(documentedKeys(example), ['DATABASE_DIR', 'KIT_TRUSTED_ORIGINS'])
})

/* ── сам аудит ───────────────────────────────────────────────────────── */

test('аудит ловит и неоговорённый ключ, и устаревший в примере', () => {
  const problems = auditEnvDocs({
    sources: { 'a.ts': 'const x = env("DB_BRAND_NEW")' },
    example: 'DATABASE_DIR=\n',
  })
  assert.equal(problems.length, 2)
  assert.match(formatProblems(problems), /DB_BRAND_NEW/)
  assert.match(formatProblems(problems), /DATABASE_DIR/)
  assert.equal(formatProblems([]), '  ✓ все ключи на месте')
})

test('переменную хостера достаточно упомянуть, но не объявлять', () => {
  const ok = auditEnvDocs({ sources: { 'a.ts': 'const v = process.env.VERCEL' }, example: '# VERCEL ставит платформа\n' })
  assert.deepEqual(ok, [])
  const bad = auditEnvDocs({ sources: { 'a.ts': 'const v = process.env.VERCEL' }, example: 'A=\n' })
  assert.equal(bad.length, 1)
})

/* ── проверка репозитория: именно она не даёт example устареть ───────── */

function readSources() {
  const out = {}
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (SCANNED_EXT.includes(name.slice(name.lastIndexOf('.')))) out[full] = readFileSync(full, 'utf8')
    }
  }
  for (const dir of SCANNED_DIRS) walk(dir)
  for (const file of SCANNED_FILES) out[file] = readFileSync(file, 'utf8')
  return out
}

test('.env.example описывает каждый ключ, который читает серверный код', () => {
  const sources = readSources()
  assert.ok(Object.keys(sources).length > 10, 'каталоги сканирования настроены неверно')
  const example = readFileSync('.env.example', 'utf8')
  const problems = auditEnvDocs({ sources, example })
  assert.deepEqual(problems, [])
})
