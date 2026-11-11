import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// Проверяем контракт команды из package.json, не подменяя npm ci в CI.
// Реальный svelte-kit запускается в интеграционной проверке отдельно.
test('prepare предупреждает при сбое sync, сохраняя совместимый exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prepare-contract-'))
  try {
    const script = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts.prepare
    const fake = join(dir, 'svelte-kit')
    for (const [code, warn] of [[0, false], [42, true]]) {
      writeFileSync(fake, `#!/bin/sh\necho fake-sync >&2\nexit ${code}\n`, { mode: 0o755 })
      const result = spawnSync('sh', ['-c', script], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8' })
      assert.equal(result.status, 0)
      assert.match(result.stderr, /fake-sync/)
      assert.equal(result.stderr.includes('WARNING: svelte-kit sync failed'), warn)
      if (warn) assert.match(result.stderr, /missing or stale/)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
