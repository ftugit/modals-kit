#!/usr/bin/env node
/**
 * Менеджер опциональных модулей приложения (`tooling/mod.mjs`).
 *
 * Позволяет держать ветку `img` чистым стартовым ядром и доустанавливать
 * витринные или доменные пакеты (например `demo`) локально и при сборке на Vercel:
 *
 *   npm run mod -- list               # список доступных модулей в источнике
 *   npm run mod -- status             # какие модули установлены локально
 *   npm run mod -- add demo           # установить модуль demo
 *   npm run mod -- remove demo        # чисто удалить модуль demo
 *   npm run mod -- sync               # синхронизировать по переменной MODULES
 *
 * Переменные окружения (читаются из process.env, затем .env.local и .env):
 *   MODULES        — список модулей через запятую/пробел (например `demo`; `none` = 0 модулей).
 *                    Если переменная не задана вообще, `sync` ничего не меняет и не ходит в сеть.
 *   MODULES_TOKEN  — GitHub Fine-Grained PAT (`Contents: Read`) для приватного репозитория.
 *   MODULES_REPO   — `owner/repo` (по умолчанию из VERCEL_GIT_REPO_OWNER/SLUG или origin, иначе `ftugit/modals-kit`).
 *   MODULES_REF    — тег или ветка с модулями (по умолчанию `modules`, т.е. `refs/tags/modules`).
 *   MODULES_SOURCE — локальная папка, `.tar.gz`-архив или прямой `https://`-URL (для тестов и офлайна).
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, posix, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'

const DEFAULT_REPO = 'ftugit/modals-kit'
const DEFAULT_REF = 'modules'
const STATE_REL_PATH = '.modules/installed.json'

/** Вычисляет SHA-256 буфера в hex. */
export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** Разбирает `.env`-файл без внешних зависимостей. */
export function parseDotEnv(text) {
  const out = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const cleaned = line.startsWith('export ') ? line.slice(7).trim() : line
    const eq = cleaned.indexOf('=')
    if (eq <= 0) continue
    const key = cleaned.slice(0, eq).trim()
    let val = cleaned.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    } else {
      const hashIdx = val.indexOf(' #')
      if (hashIdx !== -1) val = val.slice(0, hashIdx).trim()
    }
    out[key] = val
  }
  return out
}

/** Собирает переменные окружения с приоритетом `process.env > .env.local > .env`. */
export function readModEnv(rootDir, envOverride = process.env) {
  const merged = {}
  for (const file of ['.env', '.env.local']) {
    const full = join(rootDir, file)
    if (existsSync(full)) {
      Object.assign(merged, parseDotEnv(readFileSync(full, 'utf8')))
    }
  }
  for (const [k, v] of Object.entries(envOverride)) {
    if (v !== undefined) merged[k] = v
  }
  return merged
}

/** Разбирает строку `MODULES` (`"demo, extra"` -> `['demo', 'extra']`, `undefined` -> `null`). */
export function parseModulesList(raw) {
  if (raw === undefined || raw === null) return null
  const trimmed = String(raw).trim()
  if (!trimmed || /^(none|false|0|-)$/i.test(trimmed)) return []
  const items = trimmed
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  for (const name of items) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) {
      throw new Error(`[mod] Недопустимое имя модуля в MODULES: «${name}»`)
    }
  }
  return [...new Set(items)]
}

/** Извлекает `owner/repo` из URL git remote (`https://...` или `git@github.com:...`). */
export function parseGitHubRemote(remoteUrl) {
  if (!remoteUrl) return null
  const clean = String(remoteUrl).trim().replace(/\.git$/i, '')
  const httpsMatch = clean.match(/github\.com\/([^/\s]+\/[^/\s]+)$/i)
  if (httpsMatch) return httpsMatch[1]
  const sshMatch = clean.match(/github\.com:([^/\s]+\/[^/\s]+)$/i)
  if (sshMatch) return sshMatch[1]
  return null
}

/** Определяет `owner/repo` для загрузки модулей (Vercel env -> git origin -> DEFAULT_REPO). */
export function resolveRepoSlug(rootDir, env) {
  const explicit = (env.MODULES_REPO ?? '').trim()
  if (explicit) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(explicit)) {
      throw new Error(`[mod] Некорректный формат MODULES_REPO: «${explicit}» (ожидается owner/repo)`)
    }
    return explicit
  }
  const vOwner = (env.VERCEL_GIT_REPO_OWNER ?? '').trim()
  const vSlug = (env.VERCEL_GIT_REPO_SLUG ?? '').trim()
  if (vOwner && vSlug) return `${vOwner}/${vSlug}`

  try {
    const origin = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const parsed = parseGitHubRemote(origin)
    if (parsed) return parsed
  } catch {
    // На Vercel или в распакованном архиве git remote отсутствует — используем дефолт.
  }
  return DEFAULT_REPO
}

/** Проверяет относительный путь внутри репозитория/архива на отсутствие обхода (`..`). */
export function sanitizeRelPath(rawPath) {
  if (!rawPath || rawPath.includes('\0')) {
    throw new Error('[mod] Пустой или повреждённый путь в архиве модуля')
  }
  const unix = rawPath.replace(/\\/g, '/').replace(/^\/+/, '')
  const norm = posix.normalize(unix)
  if (!norm || norm === '.' || norm.startsWith('../') || norm === '..' || norm.includes('/../')) {
    throw new Error(`[mod] Небезопасный относительный путь: «${rawPath}»`)
  }
  return norm
}

function readTarString(buf, start, length) {
  const slice = buf.subarray(start, start + length)
  const nul = slice.indexOf(0)
  return (nul === -1 ? slice : slice.subarray(0, nul)).toString('utf8')
}

function readTarSize(buf, start, length) {
  // Base-256 (GNU/STAR бинарный размер при старшем бите 0x80).
  if ((buf[start] & 0x80) !== 0) {
    let value = 0n
    for (let i = 1; i < length; i++) {
      value = (value << 8n) | BigInt(buf[start + i])
    }
    return Number(value)
  }
  const raw = readTarString(buf, start, length).trim()
  if (!raw) return 0
  const parsed = Number.parseInt(raw, 8)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`[mod] Некорректный размер записи в tar-архиве: «${raw}»`)
  }
  return parsed
}

/**
 * Разбирает записи PAX extended header (`<byteLen> <key>=<value>\n`) по байтовым смещениям.
 * Критично для длинных путей (>100 байт) и кириллицы в `git archive --format=tar.gz`.
 */
export function parsePaxRecords(buf) {
  const attrs = {}
  let pos = 0
  while (pos < buf.length) {
    if (buf[pos] === 0) break
    let spaceIdx = -1
    for (let i = pos; i < buf.length; i++) {
      if (buf[i] === 0x20) {
        spaceIdx = i
        break
      }
    }
    if (spaceIdx === -1) break
    const lenStr = buf.subarray(pos, spaceIdx).toString('ascii')
    const recLen = Number.parseInt(lenStr, 10)
    if (!Number.isSafeInteger(recLen) || recLen <= spaceIdx - pos + 1 || pos + recLen > buf.length) {
      break
    }
    let recEnd = pos + recLen
    if (buf[recEnd - 1] === 0x0a) recEnd -= 1
    const body = buf.subarray(spaceIdx + 1, recEnd).toString('utf8')
    const eqIdx = body.indexOf('=')
    if (eqIdx > 0) {
      attrs[body.slice(0, eqIdx)] = body.slice(eqIdx + 1)
    }
    pos += recLen
  }
  return attrs
}

/**
 * Распаковывает `.tar.gz`-архив GitHub/git-archive в память (`Map<relPath, Buffer>`),
 * поддерживая USTAR `prefix+name`, PAX (`x`/`g`) и GNU LongLink (`L`), и срезая
 * корневую обёртку архива (`owner-repo-sha/`), если все файлы лежат под `modules/`.
 */
export function extractTarGzToMap(gzBuffer, { stripRoot = true } = {}) {
  const tar = gunzipSync(gzBuffer)
  const rawEntries = []
  let offset = 0
  let globalPaxPath = null
  let nextPaxPath = null
  let nextLongLinkPath = null

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    offset += 512

    let allZero = true
    for (let i = 0; i < 512; i++) {
      if (header[i] !== 0) {
        allZero = false
        break
      }
    }
    if (allZero) continue

    const size = readTarSize(header, 124, 12)
    const typeByte = header[156]
    const typeFlag = typeByte === 0 ? '0' : String.fromCharCode(typeByte)
    const name = readTarString(header, 0, 100)
    const magic = readTarString(header, 257, 6)
    const prefix = magic.startsWith('ustar') ? readTarString(header, 345, 155) : ''
    const ustarPath = prefix ? `${prefix}/${name}` : name

    if (offset + size > tar.length) {
      throw new Error('[mod] Обрезанный tar-архив модулей')
    }
    const payload = Buffer.from(tar.subarray(offset, offset + size))
    offset += Math.ceil(size / 512) * 512

    if (typeFlag === 'x') {
      const pax = parsePaxRecords(payload)
      if (pax.path) nextPaxPath = pax.path
      continue
    }
    if (typeFlag === 'g') {
      const pax = parsePaxRecords(payload)
      if (pax.path) globalPaxPath = pax.path
      continue
    }
    if (typeFlag === 'L') {
      const nul = payload.indexOf(0)
      nextLongLinkPath = (nul === -1 ? payload : payload.subarray(0, nul)).toString('utf8')
      continue
    }

    const fullPath = nextPaxPath ?? nextLongLinkPath ?? globalPaxPath ?? ustarPath
    nextPaxPath = null
    nextLongLinkPath = null

    if (typeFlag !== '0') continue
    if (!fullPath || fullPath === 'pax_global_header') continue
    rawEntries.push({ path: fullPath.replace(/\\/g, '/'), data: payload })
  }

  const out = new Map()
  if (rawEntries.length === 0) return out

  // GitHub tarball всегда оборачивает дерево в `<owner>-<repo>-<sha>/...`,
  // а прямой `git archive` — сразу с `modules/...`. Определяем автоматически.
  const allStartWithModules = rawEntries.every((e) => e.path.startsWith('modules/'))
  for (const entry of rawEntries) {
    let rel = entry.path
    if (stripRoot && !allStartWithModules) {
      const slash = rel.indexOf('/')
      if (slash === -1) continue
      rel = rel.slice(slash + 1)
    }
    if (!rel) continue
    out.set(sanitizeRelPath(rel), entry.data)
  }
  return out
}

function walkLocalDirToMap(baseDir) {
  const out = new Map()
  function walk(cur, prefixPath) {
    for (const ent of readdirSync(cur, { withFileTypes: true })) {
      const full = join(cur, ent.name)
      const rel = prefixPath ? `${prefixPath}/${ent.name}` : ent.name
      if (ent.isDirectory()) walk(full, rel)
      else if (ent.isFile()) out.set(sanitizeRelPath(rel), readFileSync(full))
    }
  }
  walk(baseDir, '')
  return out
}

async function fetchBufferWithAuth(url, token, fetchImpl) {
  const headers = {
    'User-Agent': 'modals-kit-mod-installer',
  }
  if (url.startsWith('https://api.github.com/')) {
    headers.Accept = 'application/vnd.github+json'
    headers['X-GitHub-Api-Version'] = '2022-11-28'
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const res = await fetchImpl(url, { headers, redirect: 'follow' })
  return res
}

/** Загружает дерево источника модулей (`Map<relPath, Buffer>`) из локального пути или GitHub. */
export async function loadSourceMap(rootDir, env, fetchImpl = globalThis.fetch) {
  const source = (env.MODULES_SOURCE ?? '').trim()
  const token = (env.MODULES_TOKEN ?? '').trim()

  if (source) {
    if (/^https?:\/\//i.test(source)) {
      const res = await fetchBufferWithAuth(source, token, fetchImpl)
      if (!res.ok) {
        throw new Error(`[mod] Не удалось скачать архив модулей (${res.status}) с ${source}`)
      }
      return extractTarGzToMap(Buffer.from(await res.arrayBuffer()))
    }
    const resolved = resolve(rootDir, source)
    if (!existsSync(resolved)) {
      throw new Error(`[mod] Локальный источник MODULES_SOURCE не найден: ${resolved}`)
    }
    const st = statSync(resolved)
    if (st.isDirectory()) return walkLocalDirToMap(resolved)
    return extractTarGzToMap(readFileSync(resolved))
  }

  const repo = resolveRepoSlug(rootDir, env)
  const ref = (env.MODULES_REF ?? '').trim() || DEFAULT_REF
  const encRef = encodeURIComponent(ref)

  // При наличии токена сразу идём в официальный GitHub REST API (работает и для приватных, и для публичных репо).
  // Без токена сначала пробуем прямой codeload (0 расхода лимита API для публичных репо).
  const candidateUrls = token
    ? [`https://api.github.com/repos/${repo}/tarball/${encRef}`]
    : [
        `https://codeload.github.com/${repo}/tar.gz/refs/tags/${encRef}`,
        `https://codeload.github.com/${repo}/tar.gz/refs/heads/${encRef}`,
        `https://api.github.com/repos/${repo}/tarball/${encRef}`,
      ]

  let lastStatus = 0
  for (const url of candidateUrls) {
    const res = await fetchBufferWithAuth(url, token, fetchImpl)
    lastStatus = res.status
    if (res.ok) {
      return extractTarGzToMap(Buffer.from(await res.arrayBuffer()))
    }
    if (res.status === 401 || res.status === 403) break
  }

  const hint = token
    ? 'Проверьте права MODULES_TOKEN (нужен Fine-Grained PAT с Contents: Read для репозитория) и наличие тега/ветки MODULES_REF.'
    : 'Если репозиторий приватный, задайте переменную окружения MODULES_TOKEN (Fine-Grained PAT с правом Contents: Read).'
  throw new Error(
    `[mod] Не удалось загрузить модули из ${repo}@${ref} (HTTP ${lastStatus}). ${hint}`,
  )
}

/** Извлекает каталог доступных модулей из `Map<relPath, Buffer>`. */
export function readCatalogFromMap(sourceMap) {
  const catalog = new Map()
  for (const [relPath, buf] of sourceMap.entries()) {
    const m = relPath.match(/^modules\/([a-z0-9][a-z0-9_-]*)\/manifest\.json$/i)
    if (!m) continue
    const name = m[1]
    const manifest = JSON.parse(buf.toString('utf8'))
    const prefix = `modules/${name}/files/`
    const files = new Map()
    for (const [fPath, fBuf] of sourceMap.entries()) {
      if (fPath.startsWith(prefix)) {
        const targetRel = sanitizeRelPath(fPath.slice(prefix.length))
        files.set(targetRel, fBuf)
      }
    }
    catalog.set(name, {
      name,
      version: String(manifest.version ?? '1.0.0'),
      description: String(manifest.description ?? ''),
      files,
    })
  }
  return catalog
}

export function readInstalledState(rootDir) {
  const statePath = join(rootDir, STATE_REL_PATH)
  if (!existsSync(statePath)) return { version: 1, modules: {} }
  const parsed = JSON.parse(readFileSync(statePath, 'utf8'))
  return {
    version: 1,
    modules: parsed && typeof parsed.modules === 'object' ? parsed.modules : {},
  }
}

function writeInstalledState(rootDir, state) {
  const names = Object.keys(state.modules)
  const stateDir = join(rootDir, '.modules')
  const statePath = join(rootDir, STATE_REL_PATH)
  if (names.length === 0) {
    if (existsSync(statePath)) unlinkSync(statePath)
    if (existsSync(stateDir) && readdirSync(stateDir).length === 0) {
      rmSync(stateDir, { recursive: true, force: true })
    }
    return
  }
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8')
}

function pruneEmptyParents(rootDir, relFilePath) {
  let dir = dirname(join(rootDir, relFilePath))
  const stopAt = resolve(rootDir)
  while (dir.startsWith(stopAt) && dir !== stopAt) {
    if (!existsSync(dir)) {
      dir = dirname(dir)
      continue
    }
    if (readdirSync(dir).length > 0) break
    rmSync(dir, { recursive: true, force: true })
    dir = dirname(dir)
  }
}

/** Устанавливает один модуль из каталога в `rootDir`. */
export function installModuleFromCatalog(rootDir, catalog, name, state, { force = false } = {}) {
  const pkg = catalog.get(name)
  if (!pkg) {
    const available = [...catalog.keys()].sort().join(', ') || 'нет модулей'
    throw new Error(`[mod] Модуль «${name}» не найден в источнике (доступны: ${available})`)
  }

  const prevOwned = state.modules[name]?.files ?? {}
  const otherOwned = new Map()
  for (const [otherName, otherMeta] of Object.entries(state.modules)) {
    if (otherName === name) continue
    for (const f of Object.keys(otherMeta.files ?? {})) otherOwned.set(f, otherName)
  }

  // 1. Предварительная проверка конфликтов ДО записи на диск.
  for (const [relPath, incomingBuf] of pkg.files.entries()) {
    const owner = otherOwned.get(relPath)
    if (owner && !force) {
      throw new Error(
        `[mod] Конфликт файлов: «${relPath}» уже принадлежит модулю «${owner}»`,
      )
    }
    const absPath = join(rootDir, relPath)
    if (existsSync(absPath) && !(relPath in prevOwned) && !force) {
      const diskHash = sha256Hex(readFileSync(absPath))
      const nextHash = sha256Hex(incomingBuf)
      if (diskHash !== nextHash) {
        throw new Error(
          `[mod] Файл «${relPath}» уже существует в проекте и отличается от модуля «${name}». Используйте --force для перезаписи.`,
        )
      }
    }
  }

  // 2. Удаляем устаревшие файлы прежней версии этого же модуля.
  for (const oldRel of Object.keys(prevOwned)) {
    if (!pkg.files.has(oldRel)) {
      const oldAbs = join(rootDir, oldRel)
      if (existsSync(oldAbs)) {
        unlinkSync(oldAbs)
        pruneEmptyParents(rootDir, oldRel)
      }
    }
  }

  // 3. Записываем файлы модуля и фиксируем контрольные суммы.
  const recordedFiles = {}
  for (const [relPath, incomingBuf] of pkg.files.entries()) {
    const absPath = join(rootDir, relPath)
    mkdirSync(dirname(absPath), { recursive: true })
    writeFileSync(absPath, incomingBuf)
    recordedFiles[relPath] = sha256Hex(incomingBuf)
  }

  state.modules[name] = {
    version: pkg.version,
    installedAt: new Date().toISOString(),
    files: recordedFiles,
  }
  return pkg.files.size
}

/** Удаляет установленный модуль и его пустые директории. */
export function removeInstalledModule(rootDir, name, state, { force = false } = {}) {
  const entry = state.modules[name]
  if (!entry) return 0
  const files = entry.files ?? {}

  if (!force) {
    const dirty = []
    for (const [relPath, expectedHash] of Object.entries(files)) {
      const absPath = join(rootDir, relPath)
      if (!existsSync(absPath)) continue
      const currentHash = sha256Hex(readFileSync(absPath))
      if (currentHash !== expectedHash) dirty.push(relPath)
    }
    if (dirty.length > 0) {
      throw new Error(
        `[mod] Отказ удаления «${name}»: файлы изменены локально (${dirty.slice(0, 5).join(', ')}). Передайте --force для принудительного удаления.`,
      )
    }
  }

  let removedCount = 0
  for (const relPath of Object.keys(files)) {
    const absPath = join(rootDir, relPath)
    if (existsSync(absPath)) {
      unlinkSync(absPath)
      removedCount++
    }
    pruneEmptyParents(rootDir, relPath)
  }

  delete state.modules[name]
  return removedCount
}

function isModuleIntactOnDisk(rootDir, entry) {
  if (!entry || !entry.files) return false
  const keys = Object.keys(entry.files)
  if (keys.length === 0) return false
  for (const relPath of keys) {
    if (!existsSync(join(rootDir, relPath))) return false
  }
  return true
}

/** Выполняет CLI-команду менеджера модулей (`list | status | add | remove | sync`). */
export async function runModCli(argv, { rootDir = process.cwd(), env = process.env, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const args = argv.filter((a) => a !== '--')
  const force = args.includes('--force') || args.includes('-f')
  const positional = args.filter((a) => !a.startsWith('-'))
  const cmd = positional[0] ?? 'status'
  const targets = positional.slice(1)
  const resolvedEnv = readModEnv(rootDir, env)

  if (cmd === 'status') {
    const state = readInstalledState(rootDir)
    const names = Object.keys(state.modules)
    if (names.length === 0) {
      log('[mod] Установленных опциональных модулей нет (чистое ядро).')
    } else {
      for (const name of names) {
        const meta = state.modules[name]
        log(`[mod] ${name}@${meta.version} (${Object.keys(meta.files ?? {}).length} файлов)`)
      }
    }
    return { installed: names }
  }

  if (cmd === 'list') {
    const state = readInstalledState(rootDir)
    const sourceMap = await loadSourceMap(rootDir, resolvedEnv, fetchImpl)
    const catalog = readCatalogFromMap(sourceMap)
    if (catalog.size === 0) {
      log('[mod] В источнике модулей не найдено ни одного пакета.')
      return { available: [] }
    }
    for (const [name, pkg] of catalog.entries()) {
      const mark = state.modules[name] ? ' [установлен]' : ''
      log(`[mod] ${name}@${pkg.version}${mark} — ${pkg.description} (${pkg.files.size} файлов)`)
    }
    return { available: [...catalog.keys()] }
  }

  if (cmd === 'add') {
    if (targets.length === 0) {
      throw new Error('[mod] Укажите имя модуля: npm run mod -- add demo')
    }
    const state = readInstalledState(rootDir)
    const sourceMap = await loadSourceMap(rootDir, resolvedEnv, fetchImpl)
    const catalog = readCatalogFromMap(sourceMap)
    for (const name of targets) {
      const count = installModuleFromCatalog(rootDir, catalog, name, state, { force })
      log(`[mod] Установлен модуль «${name}» (${count} файлов).`)
    }
    writeInstalledState(rootDir, state)
    return { installed: Object.keys(state.modules) }
  }

  if (cmd === 'remove' || cmd === 'rm') {
    if (targets.length === 0) {
      throw new Error('[mod] Укажите имя модуля: npm run mod -- remove demo')
    }
    const state = readInstalledState(rootDir)
    for (const name of targets) {
      if (!state.modules[name]) {
        log(`[mod] Модуль «${name}» не установлен — пропускаю.`)
        continue
      }
      const count = removeInstalledModule(rootDir, name, state, { force })
      log(`[mod] Удалён модуль «${name}» (${count} файлов).`)
    }
    writeInstalledState(rootDir, state)
    return { installed: Object.keys(state.modules) }
  }

  if (cmd === 'sync') {
    const desired = parseModulesList(resolvedEnv.MODULES)
    // Если MODULES вообще не задан ни в окружении, ни в .env — ничего не трогаем и не идём в сеть.
    if (desired === null) {
      return { synced: false, installed: Object.keys(readInstalledState(rootDir).modules) }
    }

    const state = readInstalledState(rootDir)
    const desiredSet = new Set(desired)
    let mutated = false

    // Сначала снимаем модули, которых больше нет в списке MODULES.
    for (const installedName of Object.keys(state.modules)) {
      if (!desiredSet.has(installedName)) {
        const count = removeInstalledModule(rootDir, installedName, state, { force: true })
        log(`[mod] Снят модуль «${installedName}» (${count} файлов, отсутствует в MODULES).`)
        mutated = true
      }
    }

    const missing = desired.filter((name) => !isModuleIntactOnDisk(rootDir, state.modules[name]))
    if (missing.length > 0) {
      const sourceMap = await loadSourceMap(rootDir, resolvedEnv, fetchImpl)
      const catalog = readCatalogFromMap(sourceMap)
      for (const name of missing) {
        const count = installModuleFromCatalog(rootDir, catalog, name, state, { force: true })
        log(`[mod] Синхронизирован модуль «${name}» (${count} файлов).`)
        mutated = true
      }
    }

    if (mutated) writeInstalledState(rootDir, state)
    return { synced: true, installed: Object.keys(state.modules) }
  }

  throw new Error(
    `[mod] Неизвестная команда «${cmd}». Доступные команды: list, status, add, remove, sync`,
  )
}

const isCliEntry =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isCliEntry) {
  runModCli(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
