/**
 * Сквозная проверка ЖИВОГО источника Shikimori в браузере — того же
 * пагинатора, что и в `paginate.mjs`, но с источником `animes`:
 *
 *  1. Бэкенд-эндпоинт: `limit` режется до 50 (предел API), мусор в параметрах
 *     даёт 400, `search` реально сужает выдачу, словарь коррекции собирается;
 *  2. SSR: страница с `?page.src=animes` приходит с тайтлами В РАЗМЕТКЕ
 *     (сервер сходил в API сам, без HTTP-запроса к себе и без выгрузки каталога);
 *  3. Числа страниц у источника нет by design → навигация стрелками, без номеров;
 *  4. Родной поиск источника: `q` → `search` в API — работает БЕЗ lib/search;
 *  5. `srch=off` — запрос до API не доходит, но lib/search продолжает искать
 *     (сканирование каталога без сужения);
 *  6. lib/search: опечатка «нарута» исправляется словарём, в панели появляется
 *     подпись подмены запроса, и находится «Наруто», которого родной поиск без
 *     коррекции не находит.
 *
 * Тест сетевой (ходит на shikimori.io) — отдельным файлом, чтобы оффлайн-набор
 * оставался независимым от доступности внешнего сервиса.
 *
 * Запуск: MODALS_PORT=4173 node test/browser/shikimori.mjs
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = Number(process.env.MODALS_PORT ?? process.env.PORT ?? 4173);
const BASE = process.env.MODALS_BASE ?? `http://127.0.0.1:${PORT}`;
const U = `${BASE}/paginator`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let serverProc = null;

async function isServerUp(url) {
  try {
    const res = await fetch(url);
    return res.status < 500;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await isServerUp(U)) return;
  console.log(`Starting preview server on port ${PORT}...`);
  serverProc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'], {
    stdio: 'ignore',
    detached: true,
    cwd: process.cwd(),
  });
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    if (await isServerUp(U)) return;
  }
  throw new Error(`Server failed to start on port ${PORT}`);
}

function killServer() {
  if (serverProc && serverProc.pid) {
    try {
      process.kill(-serverProc.pid, 'SIGKILL');
    } catch {
      try {
        serverProc.kill('SIGKILL');
      } catch {}
    }
  }
}

/** Ожидание предиката (сеть: api/SSR отвечают с задержкой). */
async function waitFor(fn, { timeout = 20000, every = 250, what = 'условие' } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > until) throw new Error(`Таймаут ожидания: ${what}`);
    await sleep(every);
  }
}

async function api(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { accept: 'application/json' },
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function checkApi() {
  console.log('— Бэкенд: /api/shikimori/animes (клэмп limit, search, словарь) —');
  const big = await api('/api/shikimori/animes?page=1&limit=100');
  if (big.status !== 200) throw new Error(`limit=100 → HTTP ${big.status}`);
  if (big.body.items.length !== 50)
    throw new Error(`limit=100 должен клампиться до 50, пришло ${big.body.items.length}`);
  if (big.body.hasNext !== true) throw new Error('полная страница обязана иметь hasNext=true');
  const first = big.body.items[0];
  for (const key of ['id', 'name', 'url', 'kind', 'score', 'poster', 'thumb']) {
    if (!(key in first)) throw new Error(`в карточке нет поля ${key}: ${JSON.stringify(first)}`);
  }
  if (!first.url.startsWith('https://shikimori.'))
    throw new Error(`ссылка тайтла не абсолютная: ${first.url}`);
  console.log(`  ok  limit=100 → 50 записей, hasNext=true, карточка с абсолютными адресами`);

  const bad = await api('/api/shikimori/animes?page=0');
  if (bad.status !== 400) throw new Error(`page=0 → HTTP ${bad.status}, ожидался 400`);
  const junk = await api('/api/shikimori/animes?limit=abc');
  if (junk.status !== 400) throw new Error(`limit=abc → HTTP ${junk.status}, ожидался 400`);
  console.log('  ok  мусор в параметрах — 400 (deny-safe), а не молчаливый дефолт');

  const found = await api(`/api/shikimori/animes?page=1&limit=20&search=${encodeURIComponent('наруто')}`);
  if (found.status !== 200 || !found.body.items.length)
    throw new Error(`родной поиск «наруто» не дал записей: HTTP ${found.status}`);
  if (!found.body.items.some((it) => /наруто/i.test(it.russian ?? it.name)))
    throw new Error('в выдаче поиска «наруто» нет самого «Наруто»');
  console.log(`  ok  родной поиск источника: «наруто» → ${found.body.items.length} записей API`);

  const terms = await fetch(`${BASE}/api/shikimori/terms`).then(async (r) => ({
    status: r.status,
    text: await r.text(),
  }));
  if (terms.status !== 200 || !terms.text.includes('\t'))
    throw new Error(`словарь коррекции не собран: HTTP ${terms.status}`);
  if (!/наруто/i.test(terms.text)) throw new Error('в словаре нет «наруто» — коррекция не сработает');
  console.log('  ok  словарь коррекции собран из живых страниц популярности');
}

/**
 * Фильтры каталога (этап 3): схема живёт в зоне источника и приезжает готовой,
 * применяется СЕРВЕРОМ — клиент про `genre_v2`/`season` не знает вовсе.
 *
 * Проверяется то, что нельзя увидеть в разметке: связки (поиск под `latest` не
 * работает — `q` отбрасывается с причиной), deny-safe (чужое значение фильтра
 * не сужает выдачу, но и не молчит) и паритет SSR с роутом на одном фильтре.
 */
async function checkFilters() {
  console.log('— Фильтры: схема источника, применение на сервере, связки —');
  const schema = await fetch(`${BASE}/api/shikimori/filters`).then(async (r) => ({
    status: r.status,
    body: await r.json(),
  }));
  if (schema.status !== 200) throw new Error(`/api/shikimori/filters → HTTP ${schema.status}`);
  const builtAt = Date.parse(schema.body.builtAt ?? '');
  if (!Number.isFinite(builtAt)) throw new Error('у схемы нет метки builtAt');
  if (Date.now() - builtAt > 60 * 60 * 1000) throw new Error('схема старше часа — обновление не работает');
  const keys = schema.body.fields.map((f) => f.key);
  for (const key of ['genres', 'studios', 'kind', 'status', 'rating', 'duration', 'score', 'year'])
    if (!keys.includes(key)) throw new Error(`в схеме нет поля ${key}: ${keys}`);
  const genres = schema.body.fields.find((f) => f.key === 'genres');
  if (!genres.options?.length) throw new Error('у жанров нет живых значений');
  const studios = schema.body.fields.find((f) => f.key === 'studios');
  if (studios.options.length !== 1000 || !studios.optionsTruncated)
    throw new Error(`студии не деградированы до предела: ${studios.options.length}/${studios.optionsTruncated}`);
  const rules = schema.body.rules ?? [];
  for (const id of ['search-with-latest', 'score-with-anons'])
    if (!rules.some((rule) => rule.id === id)) throw new Error(`в схеме нет связки ${id}`);
  console.log(
    `  ok  схема готова: ${keys.length} полей, жанров ${genres.options.length}, студий ${studios.options.length} (скрыто ${studios.optionsTruncated}), связок ${rules.length}`,
  );

  // Применение фильтра: год — единственное поле, значение которого видно в самой
  // записи, поэтому «фильтр правда сузил выдачу» проверяется по данным.
  const ranged = await api('/api/shikimori/animes?limit=10&filters.year.min=1990&filters.year.max=1992');
  if (ranged.status !== 200) throw new Error(`фильтр по годам → HTTP ${ranged.status}`);
  if (!ranged.body.items.length) throw new Error('фильтр 1990–1992 не дал записей');
  const outside = ranged.body.items.filter((item) => item.year < 1990 || item.year > 1992);
  if (outside.length) throw new Error(`в выдаче фильтра по годам чужие записи: ${JSON.stringify(outside[0])}`);
  if (ranged.body.dropped) throw new Error(`валидный фильтр отброшен: ${JSON.stringify(ranged.body.dropped)}`);
  console.log(`  ok  фильтр по годам применён сервером: ${ranged.body.items.length} записей, все 1990–1992`);

  // Deny-safe: чужого значения в схеме нет — фильтр не применяется, но причина едет.
  const junk = await api('/api/shikimori/animes?limit=5&filters.kind=zzz');
  const plain = await api('/api/shikimori/animes?limit=5');
  if (junk.status !== 200) throw new Error(`мусорное значение → HTTP ${junk.status}`);
  if (junk.body.dropped?.[0]?.key !== 'filters.kind')
    throw new Error(`чужое значение не объяснено: ${JSON.stringify(junk.body.dropped)}`);
  const junkIds = junk.body.items.map((item) => item.id).join(',');
  const plainIds = plain.body.items.map((item) => item.id).join(',');
  if (junkIds !== plainIds) throw new Error('мусорное значение всё-таки сузило выдачу');
  console.log('  ok  чужое значение: фильтр не применён, выдача как без фильтра, причина в ответе');

  // Связка: с «последними добавленными» поиск не работает — `q` отбрасывается.
  const ruled = await api(
    `/api/shikimori/animes?limit=5&search=${encodeURIComponent('наруто')}&filters.status=latest`,
  );
  const latest = await api('/api/shikimori/animes?limit=5&filters.status=latest');
  if (ruled.status !== 200) throw new Error(`связка latest+поиск → HTTP ${ruled.status}`);
  const droppedSearch = (ruled.body.dropped ?? []).find((item) => item.key === 'q');
  if (!droppedSearch?.reason) throw new Error(`поиск отброшен без причины: ${JSON.stringify(ruled.body.dropped)}`);
  if (ruled.body.items.map((i) => i.id).join(',') !== latest.body.items.map((i) => i.id).join(','))
    throw new Error('со связкой выдача отличается от `status=latest` без поиска — q всё-таки ушёл в API');
  console.log(`  ok  связка сработала: поиск не применён («${droppedSearch.reason}»), выдача — «последние добавленные»`);

  // Паритет SSR и роута: адрес со фильтром и запрос к роуту дают одну выборку.
  const ssrHtml = await fetch(`${U}?page.src=animes&page.size=5&page.filters.year.min=1990&page.filters.year.max=1992`).then(
    (r) => r.text(),
  );
  const ssrIds = [...ssrHtml.matchAll(/data-testid="anime-(\d+)"/g)].map((m) => m[1]);
  const routeIds = ranged.body.items.slice(0, 5).map((item) => String(item.id));
  if (!ssrIds.length) throw new Error('SSR со фильтром не отдал ни одной карточки');
  if (ssrIds.join(',') !== routeIds.join(','))
    throw new Error(`SSR и роут разошлись на одном фильтре: ${ssrIds} vs ${routeIds}`);
  console.log('  ok  SSR применяет тот же конвейер: адрес со фильтром даёт ту же выборку, что роут');
}

async function checkSsr() {
  console.log('— SSR живого источника (без JS, в разметке) —');
  const url = `${U}?page.src=animes&page.size=5`;
  const html = await fetch(url).then((r) => r.text());
  const rows = [...html.matchAll(/data-testid="anime-(\d+)"/g)].map((m) => m[1]);
  if (rows.length !== 5)
    throw new Error(`SSR: ожидалось 5 тайтлов в разметке, found ${rows.length}`);
  if (!html.includes('Shikimori'))
    throw new Error('SSR: в разметке нет ни одного названия (сервер не сходил в API?)');
  console.log(`  ok  ?page.src=animes&page.size=5 → 5 тайтлов уже в HTML (сервер сам сходил в API)`);

  const searched = await fetch(`${U}?page.src=animes&page.size=5&page.q=${encodeURIComponent('наруто')}`).then(
    (r) => r.text(),
  );
  if (!/наруто/i.test(searched))
    throw new Error('SSR с q: в разметке нет результатов родного поиска');
  console.log('  ok  SSR с ?page.q: источник сузил выдачу подстрокой (контур без JS)');
}

/**
 * Опции браузерного прогона: одна страница за раз и без жестов у кромок —
 * живой источник должен отдавать ровно то, что запрошено (иначе накопление
 * само подгружает следующие страницы, и счёт строк перестаёт быть проверкой).
 */
const OPTS = 'page.mode=single&page.topTrigger=off&page.bottomTrigger=off';

/** Строки живого источника внутри хоста демо-пагинатора. */
const rowsOf = (page) => page.locator('[data-paginator-host="demo-url"] a[data-testid^="anime-"]');

async function checkBrowser(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  try {
    console.log('— Живой источник в браузере: навигация и родной поиск —');
    await page.goto(`${U}?page.src=animes&page.size=5&${OPTS}`, { waitUntil: 'networkidle' });
    await waitFor(async () => (await rowsOf(page).count()) === 5, { what: '5 строк Shikimori' });
    // Числа страниц API не отдаёт (totalPages = null) → в навигации только
    // стрелки и нет ни номерных кнопок, ни счётчика «СТР N из M» (R12).
    const navText = (await page.locator('[data-paginator-host="demo-url"] [data-testid="page-nav"]').innerText()).replace(/\s+/g, ' ');
    if (/\d/.test(navText) || !navText.includes('←') || !navText.includes('→'))
      throw new Error(`навигация источника без totalItems должна быть стрелочной: «${navText}»`);
    const page1 = await rowsOf(page).evaluateAll((els) => els.map((el) => el.dataset.testid));
    console.log(`  ok  5 строк в хосте, номера страниц не рисуются: навигация «${navText}»`);

    await page.locator('[data-paginator-host="demo-url"] a[aria-label="Вперёд"], button[aria-label="Вперёд"]').first().evaluate((el) => el.click());
    await waitFor(async () => page.url().includes('page=2'), { what: 'переход на стр. 2' });
    await waitFor(async () => {
      const ids = await rowsOf(page).evaluateAll((els) => els.map((el) => el.dataset.testid));
      return ids.length === 5 && ids[0] !== page1[0];
    }, { what: 'вторая страница с другими тайтлами' });
    console.log('  ok  «Вперёд» даёт следующую страницу API (другие тайтлы)');

    // Родной поиск источника: query живёт в адресе, выдачу сузил API.
    const input = page.locator('[data-testid="search-input"]');
    if (await input.isDisabled()) throw new Error('при включённом srch поле поиска должно быть активным');
    await input.fill('наруто');
    await input.press('Enter');
    await waitFor(async () => page.url().includes(`page.q=${encodeURIComponent('наруто')}`), {
      what: 'запрос в адресе (?page.q)',
    });
    await waitFor(async () => {
      const texts = await rowsOf(page).allInnerTexts();
      return texts.some((t) => /наруто/i.test(t));
    }, { what: 'результаты родного поиска' });
    const nativeState = await page.locator('[data-testid="search-state"]').innerText();
    if (!/Родной поиск: вкл/.test(nativeState) || !/lib\/search: выкл/.test(nativeState))
      throw new Error(`состояние опций не отражает матрицу: ${nativeState}`);
    console.log('  ok  родной поиск работает БЕЗ lib/search (q → search в API, ключ в адресе)');

    // Опечатка без lib/search: коррекции нет (подпись «искали …» не появляется).
    await input.fill('нарута');
    await input.press('Enter');
    await waitFor(async () => page.url().includes(`page.q=${encodeURIComponent('нарута')}`), {
      what: 'запрос-опечатка в адресе',
    });
    await sleep(1500);
    const noLsState = await page.locator('[data-testid="search-state"]').innerText();
    if (/искали/.test(noLsState))
      throw new Error(`без lib/search подписи коррекции быть не должно: ${noLsState}`);
    console.log('  ok  без lib/search опечатка идёт в API как есть (коррекции нет)');

    console.log('— lib/search поверх того же поиска: коррекция и подпись —');
    await page.locator('[data-testid="demo-panel"] input[name="page.ls"][type="checkbox"]').evaluate((el) => el.click());
    await waitFor(async () => (await page.locator('[data-testid="search-ls"]').innerText()) === 'вкл', {
      what: 'тумблер lib/search включён',
    });
    await waitFor(async () => {
      const texts = await rowsOf(page).allInnerTexts();
      return texts.some((t) => /наруто/i.test(t));
    }, { what: 'lib/search нашёл «Наруто» по «нарута»', timeout: 30000 });
    const correctionNote = await page.locator('[data-testid="search-correction"]').innerText();
    if (!/искали «нарута», показываем «наруто»/i.test(correctionNote))
      throw new Error(`подпись коррекции не та: «${correctionNote}»`);
    const statsWithSrch = await page.locator('[data-testid="search-stats"]').innerText();
    console.log(`  ok  коррекция опечатки: ${correctionNote.replace(/\s+/g, ' ').trim()}`);
    console.log(`      сужение родным поиском после коррекции: ${statsWithSrch.replace(/\s+/g, ' ').trim()}`);

    console.log('— Тумблер «родной поиск» выключен: lib/search ищет без сужения —');
    await page.locator('[data-testid="demo-panel"] input[name="page.srch"][type="checkbox"]').evaluate((el) => el.click());
    await waitFor(async () => (await page.locator('[data-testid="search-native"]').innerText()) === 'выкл', {
      what: 'тумблер родного поиска выключен',
    });
    // lib/search жив (тумблер `ls` включён) — искать по-прежнему есть чем,
    // поэтому поле запроса ОСТАЁТСЯ активным: гасится родное применение
    // запроса источником, а не возможность искать вообще.
    if (await input.isDisabled())
      throw new Error('при включённом lib/search поле поиска должно оставаться активным');
    await waitFor(async () => {
      const texts = await rowsOf(page).allInnerTexts();
      return texts.some((t) => /наруто/i.test(t));
    }, { what: 'lib/search нашёл по каталогу без сужения', timeout: 30000 });
    const statsNoSrch = await page.locator('[data-testid="search-stats"]').innerText();
    if (!/просмотрено \d+/.test(statsNoSrch))
      throw new Error(`нет живой статистики сканирования: ${statsNoSrch}`);
    const scannedWith = Number(/просмотрено (\d+)/.exec(statsWithSrch.replace(/\s+/g, ' '))?.[1] ?? 0);
    const scannedWithout = Number(/просмотрено (\d+)/.exec(statsNoSrch.replace(/\s+/g, ' '))?.[1] ?? 0);
    if (!(scannedWithout > scannedWith))
      throw new Error(
        `без сужения источника сканируется больше записей, чем с ним: ${scannedWithout} vs ${scannedWith}`,
      );
    console.log(
      `  ok  srch=off: запрос до API не доходит (${statsNoSrch.replace(/\s+/g, ' ').trim()}), ` +
        `сканирование выросло ${scannedWith} → ${scannedWithout}`,
    );

    // Ссылка переносима: тот же адрес в свежем контексте = те же опции и выдача.
    const shared = page.url(); // уже с OPTS: одна страница, без жестов у кромок
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const p2 = await ctx2.newPage();
    p2.setDefaultTimeout(20000);
    await p2.goto(shared, { waitUntil: 'networkidle' });
    await waitFor(async () => (await p2.locator('[data-testid="search-native"]').innerText()) === 'выкл', {
      what: 'опции восстановлены из адреса',
    });
    await waitFor(async () => (await p2.locator('[data-paginator-host="demo-url"] a[data-testid^="anime-"]').count()) > 0, {
      what: 'выдача восстановлена из адреса',
    });
    await ctx2.close();
    console.log('  ok  адрес переносим: источник, тумблеры и запрос восстанавливаются у соседа');

    console.log('— Выключены оба: обычный каталог —');
    const bothOff = new URL(shared);
    bothOff.searchParams.set('page.ls', 'false');
    bothOff.searchParams.set('page.srch', 'false');
    await page.goto(bothOff.toString(), { waitUntil: 'networkidle' });
    await waitFor(async () => (await rowsOf(page).count()) === 5, { what: 'каталог без поиска' });
    // Поиска нет вовсе (ни родного, ни lib/search) — поле запроса погашено,
    // и это следует из возможностей источника, а не из имени `src`.
    const searchInput = page.locator('[data-testid="search-input"]');
    await waitFor(async () => await searchInput.isDisabled(), { what: 'поле поиска погашено без поиска вовсе' });
    // Тумблеры гасят ПРИМЕНЕНИЕ запроса, но не стирают ввод пользователя:
    // ключ `q` остаётся в адресе (ссылка переносима), а выдача — обычный каталог.
    if (!page.url().includes('page.q='))
      throw new Error('запрос пользователя не должен пропадать из адреса при гашении тумблеров');
    const plainIds = await rowsOf(page).evaluateAll((els) =>
      els.map((el) => el.dataset.testid.replace('anime-', '')),
    );
    const top = await api('/api/shikimori/animes?page=1&limit=5');
    const topIds = top.body.items.map((it) => String(it.id));
    if (plainIds.join(',') !== topIds.join(','))
      throw new Error(`при выключенных тумблерах выдача не совпала с началом каталога: ${plainIds} vs ${topIds}`);
    console.log('  ok  оба тумблера выключены: обычный каталог (начало каталога), ввод и адрес целы');

    await context.close();
  } finally {
    if (!context.closed) await context.close().catch(() => {});
  }
}

async function run() {
  await ensureServer();
  await checkApi();
  await checkFilters();
  await checkSsr();
  const browser = await chromium.launch({ headless: true });
  try {
    await checkBrowser(browser);
    console.log('\n✅ Живой источник Shikimori: SSR, стрелочная навигация, родной поиск и lib/search');
  } finally {
    await browser.close();
    killServer();
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAIL shikimori browser test:', err);
    killServer();
    process.exit(1);
  });
