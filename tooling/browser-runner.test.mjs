import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Реальный runner выполняется в отдельной папке. Preview и сьюты — заглушки:
// эти проверки не заменяют Chromium и реальную production-сборку.

/** Имена сьютов фикстуры: все, для которых runner задаёт адрес отдельно. */
const SUITES = ['probe', 'modals', 'regressions', 'forms', 'db-demo', 'fields', 'a11y', 'url-storage.check', 'layer-back.check', 'paginate']

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'browser-runner-test-'))
  const here = fileURLToPath(new URL('..', import.meta.url))
  mkdirSync(join(root, 'test/browser'), { recursive: true })
  mkdirSync(join(root, 'tooling'), { recursive: true })
  mkdirSync(join(root, 'node_modules/vite/bin'), { recursive: true })
  copyFileSync(join(here, 'test/browser/run-all.mjs'), join(root, 'test/browser/run-all.mjs'))
  for (const name of ['browser-output.mjs', 'browser-schedule.mjs']) {
    copyFileSync(join(here, 'tooling', name), join(root, 'tooling', name))
  }
  writeFileSync(join(root, 'node_modules/vite/bin/vite.js'), `
    const fs = require('node:fs'); const http = require('node:http');
    const command = process.argv[2];
    fs.appendFileSync('trace.log', JSON.stringify({ command, adapter: process.env.KIT_ADAPTER }) + '\\n');
    if (command !== 'preview') process.exit(40);
    console.log('ключ для входа: stub');
    const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
    http.createServer((req, res) => res.end('ok')).listen(port, '127.0.0.1');
  `)
  const suite = `
    import { appendFileSync } from 'node:fs';
    const keys = ['MODALS_BASE', 'FORMS_BASE', 'DB_DEMO_BASE', 'FIELDS_BASE', 'A11Y_BASE', 'URL_CHECK_BASE', 'PAGINATE_BASE', 'LAYER_BACK_BASE'];
    const env = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    env.MODALS_PORT = process.env.MODALS_PORT;
    appendFileSync('trace.log', JSON.stringify({ command: 'suite', name: process.argv[1].split('/').pop(), env }) + '\\n');
    if (process.env.STUB_SUITE_FAIL === '1') { console.error('FAIL intentional suite failure'); process.exit(7); }
  `
  for (const name of SUITES) writeFileSync(join(root, 'test/browser', `${name}.mjs`), suite)
  return root
}

function trace(root) {
  const file = join(root, 'trace.log')
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []
}

async function server() {
  const s = createServer((_req, res) => res.end('ok'))
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve))
  const address = s.address()
  assert.ok(address && typeof address !== 'string')
  return { server: s, port: address.port }
}

function run(root, suites, variables) {
  const env = { ...process.env }
  const cleared = ['MODALS_ORIGIN', 'MODALS_PORT', 'PORT', 'KT_PARALLEL', 'KT_SKIP_BUILD', 'STUB_SUITE_FAIL',
    'MODALS_BASE', 'FORMS_BASE', 'DB_DEMO_BASE', 'FIELDS_BASE', 'A11Y_BASE', 'URL_CHECK_BASE', 'PAGINATE_BASE', 'LAYER_BACK_BASE']
  for (const key of cleared) delete env[key]
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['test/browser/run-all.mjs', ...suites], {
      cwd: root, env: { ...env, ...variables }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (data) => { output += data })
    child.stderr.on('data', (data) => { output += data })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, output }))
  })
}

test('внешний origin: без build/preview, адреса сьютов и явные overrides', async () => {
  const root = fixture()
  const external = await server()
  const origin = `http://127.0.0.1:${external.port}`
  try {
    const result = await run(root, ['modals', 'paginate'], { MODALS_ORIGIN: origin, KT_PARALLEL: '1' })
    assert.equal(result.code, 0, result.output)
    assert.deepEqual(trace(root).map((x) => [x.command, x.name, x.env.MODALS_BASE, x.env.PAGINATE_BASE]), [
      ['suite', 'modals.mjs', `${origin}/modals`, `${origin}/paginator`],
      ['suite', 'paginate.mjs', origin, `${origin}/paginator`],
    ])
    rmSync(join(root, 'trace.log'))
    const overrides = await run(root, ['probe'], { MODALS_ORIGIN: origin, MODALS_BASE: 'https://example.test/own', PAGINATE_BASE: 'https://example.test/list' })
    assert.equal(overrides.code, 0, overrides.output)
    assert.deepEqual(trace(root).map((x) => [x.command, x.env.MODALS_BASE, x.env.PAGINATE_BASE]), [
      ['suite', 'https://example.test/own', 'https://example.test/list'],
    ])
  } finally {
    await new Promise((resolve) => external.server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }
})

test('локальный preview не собирает проект и не подменяет KIT_ADAPTER', async () => {
  const root = fixture()
  const available = await server()
  await new Promise((resolve) => available.server.close(resolve))
  try {
    for (const skip of [undefined, '1']) {
      const result = await run(root, ['probe'], { MODALS_PORT: String(available.port), KIT_ADAPTER: 'cloudflare', ...(skip ? { KT_SKIP_BUILD: skip } : {}) })
      assert.equal(result.code, 0, result.output)
      assert.deepEqual(trace(root).map((x) => [x.command, x.adapter]), [['preview', 'cloudflare'], ['suite', undefined]])
      rmSync(join(root, 'trace.log'))
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('каждому сьюту передаётся его адрес из карты runner, а не общий origin', async () => {
  const root = fixture()
  const external = await server()
  const origin = `http://127.0.0.1:${external.port}`
  try {
    const result = await run(root, SUITES, { MODALS_ORIGIN: origin, MODALS_PORT: String(external.port), KT_PARALLEL: '1' })
    assert.equal(result.code, 0, result.output)
    const seen = trace(root).filter((x) => x.command === 'suite')
    assert.deepEqual(seen.map((x) => x.name), SUITES.map((n) => `${n}.mjs`))
    for (const entry of seen) {
      const name = entry.name.replace(/\.mjs$/, '')
      // Страница модалок — у modals и regressions; остальные получают origin целиком.
      const modalsBase = name === 'modals' || name === 'regressions' ? `${origin}/modals` : origin
      assert.deepEqual(entry.env, {
        MODALS_BASE: modalsBase,
        FORMS_BASE: `${origin}/form`,
        DB_DEMO_BASE: `${origin}/db-demo`,
        FIELDS_BASE: `${origin}/fields`,
        A11Y_BASE: origin,
        URL_CHECK_BASE: origin,
        PAGINATE_BASE: `${origin}/paginator`,
        LAYER_BACK_BASE: origin,
        MODALS_PORT: String(external.port),
      }, name)
    }
  } finally {
    await new Promise((resolve) => external.server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }
})

test('ошибка выбранного сьюта возвращает ненулевой код и видна в отчёте', async () => {
  const root = fixture()
  const external = await server()
  try {
    const result = await run(root, ['probe'], { MODALS_ORIGIN: `http://127.0.0.1:${external.port}`, STUB_SUITE_FAIL: '1' })
    assert.equal(result.code, 1)
    assert.match(result.output, /FAIL intentional suite failure/)
    assert.match(result.output, /упало: 1/)
  } finally {
    await new Promise((resolve) => external.server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }
})
