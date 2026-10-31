/**
 * Два захода `vitest` вместо одного: «чистые» тесты параллельно, PGlite — последовательно.
 *
 * Почему не «просто больше воркеров». На стенде с 2 vCPU и ~2 ГБ RAM конфиг
 * (`vite.config.ts`) ограничивает прогон одним воркером: два воркера PGlite роняют
 * процесс (`Worker exited unexpectedly` — конкурирующие WASM-инстансы `pglite.wasm`),
 * и весь заход становится красным. Но один воркер на ВСЁ — тоже потеря: 150 файлов,
 * которым PGlite не нужен, стоят в очереди за 17 «тяжёлыми».
 *
 * Замеры на этом стенде (`img`, 167 тест-файлов):
 *   • как есть (1 воркер, изоляция):            207.8 s
 *   • два воркера на всё:                       106.0 s, но 3 файла падают (WASM-краш)
 *   • чистые 2 воркера + PGlite 1 воркер:       176.3 s, всё зелёное
 *   • PGlite с `--no-isolate` (1 воркер):        73.3 s, всё зелёное, порядок не важен
 *   • итог этого скрипта:                        ~118 s  (вместо 207.8 s)
 *
 * `--no-isolate` даёт PGlite-блоку 1.8x: граф модулей (и дорогая компиляция
 * `pglite.wasm`) переиспользуется между файлами вместо пересоздания на каждый.
 * «Чистым» файлам изоляция нужна — без неё 5 файлов падают (проверено).
 *
 * Запуск: `node tooling/vitest-split.mjs` (из `npm run test:fast`). Любой красный
 * заход делает код возврата ненулевым; списки файлов считаются по содержимому,
 * а не зашиты — новые тесты попадают в нужный заход сами.
 */
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';

/** Признаки теста, которому нужен PGlite (WASM-база в памяти). */
const PGLITE_MARKERS = [/@electric-sql\/pglite/, /\bwithTestDb\b/, /\bnew PGlite\b/];

/** Все тест-файлы под `src/` (тот же шаблон, что `test.include` в `vite.config.ts`). */
function collect(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.svelte-kit') continue;
      collect(full, found);
    } else if (/\.(test|spec)\.(js|ts)$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

const files = collect(ROOT);
const needsPglite = (file) => PGLITE_MARKERS.some((re) => re.test(readFileSync(file, 'utf8')));
const dbFiles = files.filter(needsPglite);
const pureFiles = files.filter((file) => !needsPglite(file));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const started = Date.now();

/** Один заход vitest; печатает хвост отчёта и возвращает длительность. */
async function run(label, args, extraEnv = {}) {
  const flags = args.filter((a) => a.startsWith('--'));
  const count = args.filter((a) => !a.startsWith('--')).length;
  console.log(`\n[split] ${label}: ${count} файлов, ${flags.join(' ')}`);
  const t0 = Date.now();
  const child = spawn('npx', ['vitest', 'run', ...args], {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  const code = await new Promise((resolve) => child.on('close', resolve));
  const ms = Date.now() - t0;
  console.log(`[split] ${label}: ${(ms / 1000).toFixed(1)} s, код ${code}`);
  return { code, ms };
}

// Порядок важен: сначала «чистые» (быстрые, 2 воркера), затем PGlite (1 воркер,
// без изоляции). Заходы идут последовательно: два одновременно не влезают в память.
const pure = await run('чистые, 2 воркера', ['--maxWorkers=2', ...pureFiles]);
let db = { code: 0, ms: 0 };
if (dbFiles.length) {
  await sleep(500); // дать воркерам предыдущего захода освободить память
  db = await run('PGlite, 1 воркер, без изоляции', ['--maxWorkers=1', '--no-isolate', ...dbFiles]);
}

const total = (Date.now() - started) / 1000;
console.log(`\n[split] итого ${total.toFixed(1)} s (чистые ${(pure.ms / 1000).toFixed(1)} s + PGlite ${(db.ms / 1000).toFixed(1)} s)`);
if (pure.code !== 0 || db.code !== 0) process.exitCode = 1;
