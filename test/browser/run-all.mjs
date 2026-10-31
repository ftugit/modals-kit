/**
 * Оркестратор браузерных сьютов: один `vite preview` на весь прогон и N сьютов параллельно.
 *
 * Зачем: `npm run test:browser` запускал 16 процессов Node последовательно, и каждый
 * сьют поднимал свой Chromium. На стенде с 2 vCPU полный набор занимал ~552 с, а
 * процессор при этом простаивал на ожиданиях сети (см. `docs/review-test-speedup-2026-10-31.md`).
 *
 * Что делает:
 *   1. Проверяет, есть ли уже сервер на порту (`MODALS_BASE`/`MODALS_PORT`). Нет — поднимает
 *      ОДИН `vite preview` на весь прогон и гасит его в `finally` (в том числе на Ctrl-C).
 *   2. Запускает сьюты с ограничением параллелизма `KT_PARALLEL` (по умолчанию 2: больше
 *      на 2 vCPU и 2 ГБ RAM не помещается — preview с базой PGlite в памяти однажды был
 *      убит OOM-киллером).
 *   3. Печатает таблицу «сьют → время → код возврата» и итог; код возврата процесса —
 *      ненулевой, если упал хотя бы один сьют.
 *   4. Если сервер умер посреди прогона (OOM), перезапускает его и повторяет текущий сьют
 *      один раз, а факт пишет в отчёт: молча «зелёным» это не станет.
 *
 * Запуск:
 *   node test/browser/run-all.mjs                  # все сьюты основного набора
 *   KT_PARALLEL=1 node test/browser/run-all.mjs    # последовательно, как раньше
 *   node test/browser/run-all.mjs db-demo paginate # только перечисленные
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Основной набор — сьюты фильтруются по реально установленным файлам (ядро + активные модули). */
const ALL = [
  'regressions', 'modals', 'shell', 'steps', 'forms', 'forms-a11y', 'db-demo', 'fields',
  'paginate', 'capabilities', 'errors', 'a11y', 'loader', 'auth', 'blocks', 'layer-back.check', 'url-storage.check',
];

const PORT = Number(process.env.MODALS_PORT ?? process.env.PORT ?? 5173);
const ORIGIN = process.env.MODALS_ORIGIN ?? `http://127.0.0.1:${PORT}`;
const PARALLEL = Math.max(1, Number(process.env.KT_PARALLEL ?? 2));
const SERVER_SCRIPT = 'node_modules/vite/bin/vite.js';

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const suites = only.length ? only : ALL.filter((name) => existsSync(`test/browser/${name}.mjs`));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Сервер уже отвечает? */
async function isUp() {
  try {
    const res = await fetch(`${ORIGIN}/`, { signal: AbortSignal.timeout(3000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

let serverProc = null;
let serverRestarts = 0;

async function startServer() {
  if (await isUp()) return false;
  if (!existsSync(SERVER_SCRIPT)) throw new Error(`нет ${SERVER_SCRIPT} — сначала npm ci`);
  console.log(`[run-all] поднимаю preview на ${ORIGIN}…`);
  serverProc = spawn(process.execPath, [SERVER_SCRIPT, 'preview', '--port', String(PORT), '--host', '0.0.0.0'], {
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--max-old-space-size=1100' },
  });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await isUp()) {
      console.log('[run-all] сервер готов');
      return true;
    }
    await sleep(500);
  }
  throw new Error('preview не поднялся за 90 с');
}

function stopServer() {
  if (!serverProc) return;
  try {
    process.kill(-serverProc.pid, 'SIGTERM');
  } catch {
    /* уже мёртв */
  }
  serverProc = null;
}

/** Один сьют: печатает свой вывод и возвращает { code, ms, output } */
function runSuite(name) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [`test/browser/${name}.mjs`], {
      env: { ...process.env, MODALS_PORT: String(PORT), MODALS_BASE: process.env.MODALS_BASE ?? undefined },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('close', (code) => resolve({ name, code: code ?? 1, ms: Date.now() - started, output }));
  });
}

const results = [];
let next = 0;

async function worker() {
  for (;;) {
    const index = next++;
    if (index >= suites.length) return;
    const name = suites[index];

    let result = await runSuite(name);

    // Сервер мог умереть (OOM) — это не падение проверки. Поднимаем и повторяем ОДИН раз,
    // отмечая факт в отчёте.
    if (result.code !== 0 && !(await isUp())) {
      serverRestarts += 1;
      console.warn(`[run-all] ${name}: сервер не отвечает, перезапускаю (перезапуск №${serverRestarts})`);
      stopServer();
      await startServer();
      result = await runSuite(name);
      result.restarted = true;
    }

    results[index] = result;
    const mark = result.code === 0 ? 'ok  ' : 'FAIL';
    const retry = result.restarted ? ' (после перезапуска сервера)' : '';
    console.log(`${mark} ${result.name.padEnd(20)} ${(result.ms / 1000).toFixed(1).padStart(7)} s${retry}`);
    if (result.code !== 0) {
      const tail = result.output.split('\n').filter((l) => l.includes('FAIL') || l.includes('❌')).slice(-4);
      for (const line of tail) console.log('     ' + line.trim().slice(0, 180));
    }
  }
}

process.on('SIGINT', () => {
  stopServer();
  process.exit(130);
});

const startedAt = Date.now();
try {
  await startServer();
  await Promise.all(Array.from({ length: Math.min(PARALLEL, suites.length) }, () => worker()));
} finally {
  stopServer();
}

const total = (Date.now() - startedAt) / 1000;
const failed = results.filter((r) => r && r.code !== 0);
const slowest = [...results].filter(Boolean).sort((a, b) => b.ms - a.ms).slice(0, 5);

console.log('\n───────── итог ─────────');
console.log(`сьютов: ${results.filter(Boolean).length}, упало: ${failed.length}, параллелизм: ${PARALLEL}`);
console.log(`стена: ${total.toFixed(1)} s${serverRestarts ? `, перезапусков сервера: ${serverRestarts}` : ''}`);
console.log('самые долгие: ' + slowest.map((r) => `${r.name} ${(r.ms / 1000).toFixed(1)}s`).join(', '));
if (failed.length) {
  console.log('упали: ' + failed.map((r) => r.name).join(', '));
  process.exitCode = 1;
}
