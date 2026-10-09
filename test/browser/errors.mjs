/**
 * Q1: единый канал ошибок — сквозная проверка на ПРОД-сборке (preview).
 *  1. Фатальный сценарий (fault=init + переход на local-хранилище): критическая
 *     ошибка ЗАМЕНЯЕТ приложение экраном 500; причина/стек клиенту не видны;
 *  2. Не-критичный сбой (fault=append, фаза append): приложение живо, ошибка —
 *     только в консоли ('[paginate] load-failed'), оверлея нет;
 *  3. Без отказов: чистая загрузка, в консоль ничего ошибочного не течёт.
 * ВЕТКА DEV (console.error + throw → vite-overlay) здесь не проверяется:
 * preview — это prod-бандл; поведение dev — следствие `import.meta.env.DEV`.
 *
 * Запуск: MODALS_PORT=4173 node test/browser/errors.mjs
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = Number(process.env.MODALS_PORT ?? process.env.PORT ?? 4173);
const BASE = `http://127.0.0.1:${PORT}`;
const U = `${BASE}/paginator`;

let serverProc = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isServerUp(url) {
  try {
    return (await fetch(url)).status < 600
  } catch {
    return false
  }
}

async function ensureServer() {
  if (await isServerUp(U)) return
  console.log(`Starting preview server on port ${PORT}...`)
  serverProc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'], {
    stdio: 'ignore',
    detached: true,
    cwd: process.cwd(),
  })
  for (let i = 0; i < 40; i++) {
    await sleep(300)
    if (await isServerUp(U)) return
  }
  throw new Error(`Server failed to start on port ${PORT}`)
}

function killServer() {
  if (serverProc && serverProc.pid) {
    try {
      process.kill(-serverProc.pid, 'SIGKILL')
    } catch {
      try {
        serverProc.kill('SIGKILL')
      } catch {}
    }
  }
}

async function run() {
  await ensureServer()
  const browser = await chromium.launch({ headless: true })
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
    const logs = []
    const page = await ctx.newPage()
    page.on('console', (m) => logs.push(`${m.type()}:${m.text()}`))

    console.log('— 3. чистая загрузка: без оверлея, консоль без ошибочных линий')
    await page.goto(U, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-paginator-host="demo-url"]')
    if (await page.locator('[data-testid="error-500"]').count())
      throw new Error('Оверлей 500 при чистой загрузке')
    if (!(await page.locator('text=Product 1').first().isVisible()))
      throw new Error('Список не отрисован на чистой загрузке')
    if (logs.some((l) => l.includes('[paginate]') || l.startsWith('error:')))
      throw new Error(`Консоль не чиста: ${logs.join(' | ')}`)
    console.log('  ok  чисто')

    console.log('— 1. фатал: fault=init + переключение на local → экран 500 вместо приложения')
    const page2 = await ctx.newPage()
    const logs2 = []
    page2.on('console', (m) => logs2.push(`${m.type()}:${m.text()}`))
    await page2.goto(`${U}?fault=init`, { waitUntil: 'networkidle' })
    await page2.selectOption('select[name="store"]', 'local')
    await page2.waitForSelector('[data-testid="error-500"]', { timeout: 8000 })
    const body = await page2.evaluate(() => document.body.innerText)
    if (!body.includes('Приложение недоступно'))
      throw new Error('Нет шапки 500 на экране остановки')
    for (const leak of ['Fault:', 'Error:', 'stack', 'load-failed']) {
      if (body.includes(leak))
        throw new Error(`Клиенту показана внутренняя причина: «${leak}»`)
    }
    if (await page2.locator('[data-paginator-host]').count())
      throw new Error('Дерево приложения не уничтожено (хост жив под оверлеем)')
    if (!(await page2.locator('[data-testid="error-500-reload"]').isVisible()))
      throw new Error('Нет кнопки обновления')
    console.log('  ok  500 заменил приложение; причин не видно')

    console.log('— 2. не-фатал: fault=append + догрузка → консоль, приложение живо')
    const page3 = await ctx.newPage()
    const logs3 = []
    page3.on('console', (m) => logs3.push(`${m.type()}:${m.text()}`))
    await page3.goto(`${U}?fault=append`, { waitUntil: 'networkidle' })
    await page3.waitForSelector('[data-paginator-host="demo-url"]')
    await page3.evaluate(() => {
      const el = document.querySelector('[data-paginator-host="demo-url"]')
      el.scrollTop = 999999
    })
    // ждём строку в консоли (после сетевой задержки транспорта демо)
    for (let i = 0; i < 40; i++) {
      if (logs3.some((l) => l.includes('[paginate] load-failed'))) break
      await sleep(250)
    }
    if (!logs3.some((l) => l.includes('[paginate] load-failed')))
      throw new Error(`Нет load-failed в консоли: ${logs3.join(' | ')}`)
    if (await page3.locator('[data-testid="error-500"]').count())
      throw new Error('Сбой append поднял 500 — классификация сломана')
    if (!(await page3.locator('text=Product 1').first().isVisible()))
      throw new Error('Приложение погибло на не-критичном сбое')
    console.log('  ok  append-сбой = только консоль, UI жив')

    console.log('\nERRORS: OK')
  } finally {
    await browser.close()
    killServer()
  }
}

run().catch((e) => {
  console.error('ERRORS: FAIL —', e)
  killServer()
  process.exit(1)
})
