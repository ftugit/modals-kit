import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  extractTarGzToMap,
  parseDotEnv,
  parseModulesList,
  resolveRepoSlug,
  runModCli,
} from './mod.mjs'

function makeTempDir(prefix = 'mod-test-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

test('mod: parseModulesList разбирает список, пустую строку, none и отвергает мусор', () => {
  assert.equal(parseModulesList(undefined), null)
  assert.deepEqual(parseModulesList(''), [])
  assert.deepEqual(parseModulesList('none'), [])
  assert.deepEqual(parseModulesList('demo'), ['demo'])
  assert.deepEqual(parseModulesList(' demo, extra  demo '), ['demo', 'extra'])
  assert.throws(() => parseModulesList('../evil'), /Недопустимое имя модуля/)
})

test('mod: resolveRepoSlug подхватывает VERCEL_GIT_REPO_OWNER/SLUG в контейнере без git remote', () => {
  const dir = makeTempDir('mod-vercel-')
  try {
    assert.equal(
      resolveRepoSlug(dir, {
        VERCEL_GIT_REPO_OWNER: 'acme',
        VERCEL_GIT_REPO_SLUG: 'starter-app',
      }),
      'acme/starter-app',
    )
    assert.equal(
      resolveRepoSlug(dir, {
        MODULES_REPO: 'custom/repo',
        VERCEL_GIT_REPO_OWNER: 'acme',
        VERCEL_GIT_REPO_SLUG: 'starter-app',
      }),
      'custom/repo',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('mod: parseDotEnv разбирает кавычки, комментарии и export', () => {
  const parsed = parseDotEnv(`
    # Комментарий
    MODULES="demo"
    export MODULES_REF='custom-tag'
    PLAIN=val # хвост
  `)
  assert.deepEqual(parsed, {
    MODULES: 'demo',
    MODULES_REF: 'custom-tag',
    PLAIN: 'val',
  })
})

test('mod: extractTarGzToMap распаковывает реальный git archive с PAX (>100 байт) и кириллицей', () => {
  const repoDir = makeTempDir('mod-git-archive-')
  try {
    execFileSync('git', ['init', '-q'], { cwd: repoDir })
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: repoDir })
    execFileSync('git', ['config', 'user.email', 'test@local'], { cwd: repoDir })

    const longRel =
      'modules/demo/files/src/routes/(site)/(app)/upload-demo/components/deeply-nested/UploadForecastBannerComponent.svelte'
    const utf8Rel = 'modules/demo/files/src/content/demo-catalog/памятка-витрины.md'
    const manifestRel = 'modules/demo/manifest.json'

    mkdirSync(join(repoDir, longRel, '..'), { recursive: true })
    mkdirSync(join(repoDir, utf8Rel, '..'), { recursive: true })
    writeFileSync(
      join(repoDir, manifestRel),
      JSON.stringify({ name: 'demo', version: '1.0.0', description: 'Демо' }),
    )
    writeFileSync(join(repoDir, longRel), '<p>Длинный путь PAX > 100 байт</p>\n')
    writeFileSync(join(repoDir, utf8Rel), '# Кириллица в PAX path\n')

    execFileSync('git', ['add', '-A'], { cwd: repoDir })
    execFileSync('git', ['commit', '-q', '-m', 'init modules'], { cwd: repoDir })

    const gz = execFileSync(
      'git',
      ['archive', '--format=tar.gz', '--prefix=ftugit-modals-kit-deadbeef/', 'HEAD'],
      { cwd: repoDir },
    )

    const map = extractTarGzToMap(gz)
    assert.equal(map.has(manifestRel), true)
    assert.equal(map.has(longRel), true)
    assert.equal(map.has(utf8Rel), true)
    assert.equal(map.get(longRel).toString('utf8'), '<p>Длинный путь PAX > 100 байт</p>\n')
    assert.equal(map.get(utf8Rel).toString('utf8'), '# Кириллица в PAX path\n')
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }
})

test('mod: полный цикл add -> защита от локальных правок -> remove и sync с MODULES_TOKEN', async () => {
  const srcRepo = makeTempDir('mod-src-')
  const appDir = makeTempDir('mod-app-')
  try {
    execFileSync('git', ['init', '-q'], { cwd: srcRepo })
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: srcRepo })
    execFileSync('git', ['config', 'user.email', 'test@local'], { cwd: srcRepo })

    mkdirSync(join(srcRepo, 'modules/demo/files/src/content/demo-catalog'), { recursive: true })
    writeFileSync(
      join(srcRepo, 'modules/demo/manifest.json'),
      JSON.stringify({ name: 'demo', version: '1.2.0', description: 'Витрина' }),
    )
    writeFileSync(
      join(srcRepo, 'modules/demo/files/src/content/demo-catalog/nav.ext.ts'),
      'export const navModule = { order: 10 }\n',
    )
    execFileSync('git', ['add', '-A'], { cwd: srcRepo })
    execFileSync('git', ['commit', '-q', '-m', 'pkg'], { cwd: srcRepo })
    const tarball = execFileSync(
      'git',
      ['archive', '--format=tar.gz', '--prefix=ftugit-modals-kit-abc1234/', 'HEAD'],
      { cwd: srcRepo },
    )

    let fetchCalls = 0
    let lastUrl = ''
    let lastAuth = ''
    const mockFetch = async (url, init) => {
      fetchCalls++
      lastUrl = String(url)
      lastAuth = init?.headers?.Authorization ?? ''
      return new Response(tarball, { status: 200 })
    }

    // 1. Без MODULES sync ничего не трогает и не ходит в сеть.
    const noopRes = await runModCli(['sync'], {
      rootDir: appDir,
      env: {},
      fetchImpl: mockFetch,
      log: () => {},
    })
    assert.equal(noopRes.synced, false)
    assert.equal(fetchCalls, 0)

    // 2. С MODULES=demo и MODULES_TOKEN sync идёт через api.github.com с Bearer и ставит файлы.
    await runModCli(['sync'], {
      rootDir: appDir,
      env: {
        MODULES: 'demo',
        MODULES_REPO: 'ftugit/modals-kit',
        MODULES_TOKEN: 'ghp_test_secret_token',
      },
      fetchImpl: mockFetch,
      log: () => {},
    })
    assert.equal(fetchCalls, 1)
    assert.equal(lastUrl, 'https://api.github.com/repos/ftugit/modals-kit/tarball/modules')
    assert.equal(lastAuth, 'Bearer ghp_test_secret_token')
    const installedFile = join(appDir, 'src/content/demo-catalog/nav.ext.ts')
    assert.equal(existsSync(installedFile), true)

    // 3. Повторный sync при уже установленном модуле не ходит в сеть (0 лишних запросов).
    await runModCli(['sync'], {
      rootDir: appDir,
      env: { MODULES: 'demo', MODULES_TOKEN: 'ghp_test_secret_token' },
      fetchImpl: mockFetch,
      log: () => {},
    })
    assert.equal(fetchCalls, 1)

    // 4. Ручной remove защищает локально изменённый файл без --force.
    writeFileSync(installedFile, '// локальная правка\n')
    await assert.rejects(
      () => runModCli(['remove', 'demo'], { rootDir: appDir, env: {}, log: () => {} }),
      /файлы изменены локально/,
    )
    assert.equal(existsSync(installedFile), true)

    // 5. С флагом --force remove удаляет файл, чистит пустые папки и .modules/installed.json.
    await runModCli(['remove', 'demo', '--force'], { rootDir: appDir, env: {}, log: () => {} })
    assert.equal(existsSync(installedFile), false)
    assert.equal(existsSync(join(appDir, 'src')), false)
    assert.equal(existsSync(join(appDir, '.modules')), false)
  } finally {
    rmSync(srcRepo, { recursive: true, force: true })
    rmSync(appDir, { recursive: true, force: true })
  }
})
