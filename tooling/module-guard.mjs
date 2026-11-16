#!/usr/bin/env node
/**
 * Защита ядра от случайно закоммиченного payload опциональных модулей.
 *
 * Источник истины — тег `modules`: пути `modules/<name>/files/...` — это файлы,
 * которые принадлежат модулю и не должны отслеживаться в ветках ядра (`img`,
 * `main`). Локальный fallback — `.modules/installed.json`, если тег ещё не
 * подтянут в клон.
 *
 * Запуск:
 *   node tooling/module-guard.mjs --staged   # pre-commit
 *   node tooling/module-guard.mjs --tracked  # CI
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const TAG = 'refs/tags/modules'
const MODULE_FILE = /^modules\/[^/]+\/files\/(.+)$/

/** Превращает вывод `git ls-tree -r --name-only` в множество путей ядра. */
export function parseModulePaths(treeText) {
  const paths = new Set()
  for (const raw of treeText.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const match = MODULE_FILE.exec(line)
    if (match) paths.add(match[1])
  }
  return paths
}

/** Возвращает пересечение проверяемых путей с payload модулей. */
export function findModuleFiles(paths, modulePaths) {
  return [...paths].filter((path) => modulePaths.has(path))
}

function git(root, args, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd: root,
    encoding,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function tagPaths(root) {
  const out = git(root, ['ls-tree', '-r', '--name-only', TAG])
  const paths = parseModulePaths(out)
  if (paths.size === 0) {
    throw new Error(`[module-guard] в ${TAG} не найдено ни одного modules/*/files/*`)
  }
  return paths
}

function installedPaths(root) {
  const statePath = join(root, '.modules/installed.json')
  if (!existsSync(statePath)) return null
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    const paths = new Set()
    for (const meta of Object.values(state.modules ?? {})) {
      for (const path of Object.keys(meta?.files ?? {})) paths.add(path)
    }
    return paths.size > 0 ? paths : null
  } catch {
    return null
  }
}

/** Загружает payload модулей из тега, иначе из локального состояния mod. */
export function loadModulePaths(root) {
  try {
    return tagPaths(root)
  } catch (tagError) {
    const fallback = installedPaths(root)
    if (fallback) return fallback
    throw new Error(
      `[module-guard] не удалось прочитать ${TAG}; выполните git fetch --tags origin.\n` +
        (tagError instanceof Error ? tagError.message : String(tagError)),
    )
  }
}

function staged(root) {
  const out = git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
  return out.split('\0').filter(Boolean)
}

function tracked(root) {
  const out = git(root, ['ls-files', '-z'])
  return out.split('\0').filter(Boolean)
}

function check(root, mode, modulePaths) {
  const paths = mode === 'staged' ? staged(root) : tracked(root)
  const bad = findModuleFiles(paths, modulePaths)
  if (bad.length === 0) {
    console.log(`[module-guard] ok (${mode}): payload модулей в ядре не найден`)
    return true
  }
  console.error(`[module-guard] ${mode}: файлы модуля попали в ядро:`)
  for (const path of bad.sort()) console.error(`  ${path}`)
  console.error(
    'Эти файлы должны жить в modules/<name>/files/... и устанавливаться через MODULES=<name>; ' +
      'удалить установленное: npm run mod -- remove <name>.',
  )
  return false
}

export function runGuard(root, modes) {
  const modulePaths = loadModulePaths(root)
  return modes.every((mode) => check(root, mode, modulePaths))
}

const isCliEntry =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isCliEntry) {
  try {
    const root = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim()
    const args = process.argv.slice(2)
    const modes = []
    if (args.includes('--staged')) modes.push('staged')
    if (args.includes('--tracked')) modes.push('tracked')
    if (modes.length === 0) modes.push('staged', 'tracked')
    if (!runGuard(root, modes)) process.exit(1)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
