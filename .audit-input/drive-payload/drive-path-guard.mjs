import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC_DIR = 'src'

/** Файлы, где литерал `/drive` оправдан: регистрация маршрутов и запасной адрес. */
const ALLOWED_FILES = new Set([
  'src/modules/drive/routes.ts',
  'src/sections/drive/load.server.ts',
])

const LITERAL_RE = /['"`]\/drive(?:['"`/]|$)/

/**
 * Найти литералы путей `/drive` в исходниках.
 * @param {{ path: string, source: string }[]} files
 * @returns {{ path: string, line: number, text: string }[]}
 */
export function findDrivePathLiterals(files) {
  const out = []
  for (const { path, source } of files) {
    if (ALLOWED_FILES.has(path)) continue
    source.split('\n').forEach((text, i) => {
      const trimmed = text.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
      if (text.includes('drive-path-ok:')) return
      if (!LITERAL_RE.test(text)) return
      out.push({ path, line: i + 1, text: trimmed })
    })
  }
  return out
}

function sourceFiles() {
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        walk(path)
      } else if (/\.(ts|svelte|js|mjs)$/.test(name) && !/\.test\./.test(name) && !/\.spec\./.test(name)) {
        files.push({ path, source: readFileSync(path, 'utf8') })
      }
    }
  }
  walk(SRC_DIR)
  return files
}

export function run() {
  const problems = findDrivePathLiterals(sourceFiles()).map(
    (hit) => `${hit.path}:${hit.line}: литерал пути /drive в компоненте — ${hit.text}`,
  )
  return problems
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = run()
  if (problems.length) {
    console.error('drive-path-guard: найдено нарушений:', problems.length)
    for (const p of problems) console.error('  ' + p)
    process.exit(1)
  }
  console.log('drive-path-guard: ok')
}