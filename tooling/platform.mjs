/**
 * Единственный выбор площадки сборки.
 *
 * Хосты не исполняют этот файл как свой конфиг, поэтому рядом остаются только
 * их собственные точки входа, без второй копии выбора адаптера:
 * - `wrangler.jsonc` читает `wrangler deploy` (имя worker, main, ASSETS);
 * - `Procfile` / `npm start` запускают уже собранный `server.mjs`;
 * - `vercel.json` лишь просит Vercel вызвать `npm run build`.
 *
 * Сборка: `node tooling/platform.mjs`. Площадку задаёт только `KIT_ADAPTER`.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(fileURLToPath(new URL('..', import.meta.url)))

/** @typedef {'node' | 'vercel' | 'cloudflare'} PlatformId */
/** @typedef {'build' | 'dev'} PlatformMode */

export class PlatformError extends Error {
  /**
   * @param {'platform.adapter' | 'platform.reset' | 'platform.output'} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message)
    this.name = 'PlatformError'
    this.code = code
  }
}

const PLATFORMS = {
  node: {
    module: '@sveltejs/adapter-node',
    // У adapter-node сжатие включено по умолчанию; server.mjs его не ждёт.
    options: { precompress: false },
    output: 'build/handler.js',
    bakeOrigin: false,
    resetDatabase: true,
  },
  vercel: {
    module: '@sveltejs/adapter-vercel',
    options: null,
    output: '.vercel/output/config.json',
    bakeOrigin: true,
    resetDatabase: true,
  },
  cloudflare: {
    module: '@sveltejs/adapter-cloudflare',
    options: null,
    output: null,
    bakeOrigin: false,
    resetDatabase: false,
  },
}

const RESET_FLAG = /^(1|true|yes)$/i

/**
 * @param {string | undefined} value
 */
function filled(value) {
  return (value ?? '').trim()
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {PlatformId | undefined}
 */
function explicitAdapter(env) {
  const raw = filled(env.KIT_ADAPTER).toLowerCase()
  if (!raw) return undefined
  if (!Object.hasOwn(PLATFORMS, raw)) {
    throw new PlatformError('platform.adapter', 'KIT_ADAPTER должен быть node, vercel или cloudflare')
  }
  return /** @type {PlatformId} */ (raw)
}

/**
 * @param {PlatformId} id
 */
function planFor(id) {
  const spec = PLATFORMS[id]
  return {
    id,
    source: 'KIT_ADAPTER',
    module: spec.module,
    bakeOrigin: spec.bakeOrigin,
    resetDatabase: spec.resetDatabase,
    output: spec.output,
  }
}

/**
 * Площадку сборки задаёт только KIT_ADAPTER. VERCEL, WORKERS_CI, CF_PAGES и NF_GIT_* не читаются.
 * `vite dev` без переменной остаётся на Cloudflare, как раньше: это не деплой.
 * @param {NodeJS.ProcessEnv} env
 * @param {PlatformMode} [mode]
 */
export function detectPlatform(env, mode = 'build') {
  const explicit = explicitAdapter(env)
  if (explicit) return planFor(explicit)
  if (mode === 'dev') return { ...planFor('cloudflare'), source: 'dev' }
  throw new PlatformError('platform.adapter', 'задайте KIT_ADAPTER=node, vercel или cloudflare')
}

/**
 * @param {NodeJS.ProcessEnv} env
 */
export function resetRequested(env) {
  return RESET_FLAG.test(filled(env.DATABASE_RESET))
}

/**
 * @param {ReturnType<typeof detectPlatform>} plan
 * @param {NodeJS.ProcessEnv} env
 */
export function assertBuildAllowed(plan, env) {
  if (!plan.resetDatabase && resetRequested(env)) {
    throw new PlatformError(
      'platform.reset',
      'DATABASE_RESET нельзя включать для Cloudflare: сборка worker не сбрасывает базу',
    )
  }
}

/**
 * Путь worker берётся из wrangler.jsonc, а не копируется второй константой.
 * @param {{ main?: unknown }} config
 */
export function cloudflareEntry(config) {
  if (!config || typeof config.main !== 'string') {
    throw new PlatformError('platform.output', 'wrangler.jsonc должен содержать строковый main')
  }
  const main = config.main.trim()
  const outside = !main || main.includes('\u0000') || main.startsWith('/') || main.includes('\u005c') || main.split('/').includes('..')
  if (outside) throw new PlatformError('platform.output', 'wrangler.jsonc main должен быть относительным путём внутри проекта')
  return main
}

/**
 * @param {PlatformId} id
 */
export async function createAdapter(id) {
  const spec = PLATFORMS[id]
  if (!spec) throw new PlatformError('platform.adapter', 'неизвестная площадка')
  const loaded = await import(spec.module)
  if (typeof loaded.default !== 'function') {
    throw new PlatformError('platform.adapter', `${spec.module} не экспортирует адаптер`)
  }
  return spec.options ? loaded.default(spec.options) : loaded.default()
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 */
function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' })
    child.once('error', () => reject(new PlatformError('platform.output', 'не удалось запустить шаг сборки')))
    child.once('exit', (code, signal) => {
      if (code === 0) resolve(undefined)
      else reject(new PlatformError('platform.output', signal ? 'шаг сборки прерван' : `шаг сборки завершился с кодом ${code}`))
    })
  })
}

async function main() {
  const env = process.env
  const plan = detectPlatform(env, 'build')
  assertBuildAllowed(plan, env)
  console.log(`[platform] ${plan.id} (${plan.source}) → ${plan.module}`)
  const childEnv = { ...env, KIT_PLATFORM_LOGGED: '1' }
  await run(process.execPath, ['tooling/mod.mjs', 'sync'], childEnv)
  await run(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], childEnv)
  if (plan.resetDatabase) await run(process.execPath, ['tooling/db-reset.mjs'], childEnv)
  let relative = plan.output
  if (plan.id === 'cloudflare') {
    let wrangler
    try {
      wrangler = JSON.parse(readFileSync(join(root, 'wrangler.jsonc'), 'utf8'))
    } catch {
      throw new PlatformError('platform.output', 'wrangler.jsonc должен быть JSON, который можно разобрать')
    }
    relative = cloudflareEntry(wrangler)
  }
  if (!relative || !existsSync(join(root, relative))) {
    throw new PlatformError('platform.output', `сборка ${plan.id} не создала ожидаемый файл`)
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invoked) {
  main().catch((error) => {
    const message = error instanceof PlatformError ? error.message : 'сборка платформы не завершилась'
    console.error(`[platform] ${message}`)
    process.exitCode = 1
  })
}
