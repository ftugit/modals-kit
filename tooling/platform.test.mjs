import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PlatformError,
  assertBuildAllowed,
  cloudflareEntry,
  detectPlatform,
  resetRequested,
} from './platform.mjs'

test('platform: сборка читает только KIT_ADAPTER', () => {
  assert.equal(detectPlatform({ KIT_ADAPTER: ' Node ' }).id, 'node')
  assert.equal(detectPlatform({ KIT_ADAPTER: 'vercel' }).module, '@sveltejs/adapter-vercel')
  assert.equal(detectPlatform({ KIT_ADAPTER: 'vercel' }).bakeOrigin, true)
  assert.equal(detectPlatform({ KIT_ADAPTER: 'cloudflare' }).resetDatabase, false)
  assert.equal(detectPlatform({ KIT_ADAPTER: 'node' }).output, 'build/handler.js')
  assert.equal(detectPlatform({ KIT_ADAPTER: 'node', VERCEL: '1', WORKERS_CI: '1', NF_GIT_SHA: 'abc' }).id, 'node')
  assert.throws(() => detectPlatform({ VERCEL: '1', WORKERS_CI: '1', CF_PAGES: '1', NF_GIT_SHA: 'abc', NF_GIT_BRANCH: 'img' }), (error) => {
    assert.ok(error instanceof PlatformError)
    assert.equal(error.code, 'platform.adapter')
    return true
  })
  assert.throws(() => detectPlatform({}), (error) => error.code === 'platform.adapter')
  assert.throws(() => detectPlatform({ KIT_ADAPTER: 'deno' }), (error) => {
    assert.equal(error.code, 'platform.adapter')
    assert.equal(error.message.includes('deno'), false)
    return true
  })
})

test('platform: dev без KIT_ADAPTER не деплой и не читает переменные хоста', () => {
  assert.equal(detectPlatform({ VERCEL: '1', NF_GIT_SHA: 'abc' }, 'dev').id, 'cloudflare')
  assert.equal(detectPlatform({ VERCEL: '1', KIT_ADAPTER: 'node' }, 'dev').id, 'node')
  assert.equal(detectPlatform({}, 'dev').source, 'dev')
})

test('platform: Cloudflare не принимает DATABASE_RESET', () => {
  const worker = detectPlatform({ KIT_ADAPTER: 'cloudflare' })
  assert.equal(resetRequested({ DATABASE_RESET: 'on' }), false)
  assert.equal(resetRequested({ DATABASE_RESET: '1' }), true)
  assert.doesNotThrow(() => assertBuildAllowed(worker, {}))
  assert.throws(() => assertBuildAllowed(worker, { DATABASE_RESET: 'yes' }), (error) => error.code === 'platform.reset')
  assert.doesNotThrow(() => assertBuildAllowed(detectPlatform({ KIT_ADAPTER: 'node' }), { DATABASE_RESET: '1' }))
})

test('platform: путь worker читается из wrangler, а не из второй константы', () => {
  assert.equal(cloudflareEntry({ main: ' .svelte-kit/cloudflare/_worker.js ' }), '.svelte-kit/cloudflare/_worker.js')
  assert.throws(() => cloudflareEntry({}), (error) => error.code === 'platform.output')
  assert.throws(() => cloudflareEntry({ main: '../secret' }), (error) => error.code === 'platform.output')
})
