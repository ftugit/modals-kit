/**
 * Реестр модулей: манифест — единственный источник публичных входов.
 *
 * Проверяется то, что нельзя увидеть глазами при добавлении субмодуля:
 *   • `name` уникальны, `parent`/`dependsOn` существуют и не образуют циклов;
 *   • `submodules` — ровно дети этого модуля;
 *   • каждый `entries` и `provides` путь реально существует;
 *   • `install.include`/`targets` не ссылаются на выдуманные каталоги.
 *
 * Запуск: `node tooling/module-registry.mjs`; тест — `module-registry.test.mjs`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

/**
 * @typedef {object} Manifest
 * @property {string} file абсолютный путь манифеста
 * @property {string} dir каталог модуля
 * @property {Record<string, unknown>} data
 */

/** @returns {Manifest[]} */
export function collectManifests(root = ROOT) {
  return walk(join(root, 'src', 'modules'))
    .filter((file) => file.endsWith('manifest.json'))
    .map((file) => ({ file, dir: dirname(file), data: JSON.parse(readFileSync(file, 'utf8')) }))
}

/**
 * @param {Manifest[]} manifests
 * @returns {string[]} список нарушений; пустой — реестр согласован
 */
export function checkRegistry(manifests) {
  const problems = []
  const byName = new Map()
  for (const manifest of manifests) {
    const name = manifest.data.name
    const where = relative(ROOT, manifest.file)
    if (typeof name !== 'string' || !name) {
      problems.push(`${where}: пустой name`)
      continue
    }
    if (byName.has(name)) problems.push(`${where}: name «${name}» уже объявлен в ${relative(ROOT, byName.get(name).file)}`)
    else byName.set(name, manifest)
  }

  const exists = (manifest, path) => {
    if (typeof path !== 'string' || !path) return false
    return existsSync(resolve(manifest.dir, path))
  }

  for (const manifest of manifests) {
    const where = relative(ROOT, manifest.file)
    const { data } = manifest
    const parent = data.parent
    if (parent !== undefined && !byName.has(parent)) problems.push(`${where}: parent «${parent}» не существует`)
    for (const dep of data.dependsOn ?? []) {
      if (!byName.has(dep)) problems.push(`${where}: dependsOn «${dep}» не существует`)
      if (dep === data.name) problems.push(`${where}: dependsOn ссылается на себя`)
    }
    for (const [key, path] of Object.entries(data.entries ?? {})) {
      if (!exists(manifest, path)) problems.push(`${where}: entries["${key}"] → «${path}» не существует`)
    }
    for (const [key, paths] of Object.entries(data.provides ?? {})) {
      for (const path of paths) if (!exists(manifest, path)) problems.push(`${where}: provides.${key} → «${path}» не существует`)
    }
    for (const [key, path] of Object.entries(data.install?.targets ?? {})) {
      if (!existsSync(resolve(ROOT, key))) problems.push(`${where}: install.targets["${key}"] — такого каталога нет`)
      if (typeof path !== 'string' || !path) problems.push(`${where}: install.targets["${key}"] пуст`)
    }
    for (const path of data.install?.include ?? []) {
      if (!existsSync(resolve(ROOT, path.replace(/\/\*\*$/, '')))) problems.push(`${where}: install.include «${path}» не существует`)
    }
    for (const child of data.submodules ?? []) {
      const childName = `${data.name}/${child}`
      const entry = byName.get(childName)
      if (!entry) problems.push(`${where}: submodule «${child}» (${childName}) не объявлен`)
      else if (entry.data.parent !== data.name) problems.push(`${where}: ${childName} должен иметь parent «${data.name}»`)
    }
  }

  // Циклы по parent/dependsOn: обход в глубину с цветами.
  const edges = (manifest) => {
    const out = []
    if (manifest.data.parent) out.push(manifest.data.parent)
    for (const dep of manifest.data.dependsOn ?? []) out.push(dep)
    return out.filter((name) => byName.has(name))
  }
  const state = new Map()
  const visit = (name, stack) => {
    if (state.get(name) === 'done') return
    if (state.get(name) === 'open') {
      problems.push(`цикл зависимостей: ${[...stack, name].join(' → ')}`)
      return
    }
    state.set(name, 'open')
    for (const next of edges(byName.get(name))) visit(next, [...stack, name])
    state.set(name, 'done')
  }
  for (const name of byName.keys()) visit(name, [])
  return [...new Set(problems)]
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkRegistry(collectManifests())
  if (problems.length) {
    console.error(`[module-registry] нарушений: ${problems.length}`)
    for (const problem of problems) console.error(`  • ${problem}`)
    process.exitCode = 1
  } else {
    console.log('[module-registry] реестр согласован')
  }
}
