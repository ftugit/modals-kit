#!/usr/bin/env node
/** Включает repo-local `.githooks` без внешних зависимостей. */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

try {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  if (!existsSync(join(root, '.githooks/pre-commit'))) process.exit(0)

  let current = ''
  try {
    current = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    // ключа ещё нет
  }
  if (current !== '.githooks') {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root })
  }
} catch {
  // Не git-репозиторий (архив, CI-артефакт) — hooks не нужны.
}
