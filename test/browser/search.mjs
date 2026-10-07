/**
 * Сквозная проверка раздела «Пагинатор + поиск» в реальном браузере (Svelte 5).
 *
 * Проверяет то, чего не видно в unit-тестах: SSR-снапшот каталога Shikimori
 * (наш бэкенд ходит в API напрямую), два выключателя поиска в демо-панели и
 * разницу между ними:
 *   1. `?page.search=false` — поиска нет: поля нет, запрос не учитывается;
 *   2. `?page.fuzzy=false`  — родной поиск источника (подстрока на бэкенде);
 *   3. оба включены         — lib search: fuzzy-перехват исправляет опечатку
 *                             («нарута» → «наруто») и показывает счётчики.
 * Плюс: размер страницы = `limit` запроса к API (потолок 50 — у API), адрес
 * хранит запрос ключом `?page.q`, страницы выдачи не повторяются.
 *
 * ⚠️ Тест ходит в живой Shikimori API через наш бэкенд и требует сети.
 * Запуск:
 *   MODALS_PORT=4173 node test/browser/search.mjs
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = Number(process.env.MODALS_PORT ?? process.env.PORT ?? 4173);
const U = process.env.SEARCH_BASE ?? `http://127.0.0.1:${PORT}/paginator`;

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ключи пагинатора, глушащие автоподгрузку: считаем ровно одну страницу. */
const QUIET = 'page.topTrigger=off&page.bottomTrigger=off';

/**
 * Корни карточек выдачи — только `anime-<id>`: внутри карточки есть служебные
 * testid'ы (`anime-score-<id>`, `anime-kind-<id>`, `anime-link-<id>`), их отсекаем.
 */
const cardsOf = (page) =>
  page.$$eval('[data-paginator-host="demo-url"] [data-testid]', (els) =>
    els
      .map((el) => el.getAttribute('data-testid'))
      .filter((t) => /^anime-\d+$/.test(t)),
  );

const titlesOf = (page) =>
  page.$$eval('[data-paginator-host="demo-url"] h3', (els) => els.map((el) => el.textContent.trim()));

async function run() {
  await ensureServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

    // ── 1. SSR: каталог Shikimori приходит от бэкенда, а не из браузера ─────
    console.log('— SSR каталога Shikimori —');
    const ssrUrl = `${U}?page.kind=anime&page.size=5&${QUIET}`;
    const html = await (await fetch(ssrUrl)).text();
    const ssrCards = [...html.matchAll(/data-testid="anime-(\d+)"/g)].map((m) => m[1]);
    if (ssrCards.length !== 5)
      throw new Error(`SSR: карточек аниме ${ssrCards.length}, ожидалось 5 (размер страницы = limit)`);
    if (!html.includes('Атака титанов'))
      throw new Error('SSR: в выдаче нет «Атаки титанов» — источник отдаёт не популярное?');
    if (!html.includes('/uploads/poster/'))
      throw new Error('SSR: в разметке нет постеров каталога');
    if (html.includes('Ничего не найдено')) throw new Error('SSR: пустое состояние вместо выдачи');
    console.log(`  ok  SSR отдал ${ssrCards.length} карточек с постерами (источник — бэкенд)`);

    // limit — это то, «сколько отдаёт API»: размер страницы ему и передаётся
    const api = await (await fetch(`http://127.0.0.1:${PORT}/api/anime?page=1&limit=7`)).json();
    if (api.items.length !== 7) throw new Error(`/api/anime?limit=7 вернул ${api.items.length}`);
    if (typeof api.hasNext !== 'boolean') throw new Error('/api/anime не отдал hasNext');
    const apiOver = await (await fetch(`http://127.0.0.1:${PORT}/api/anime?page=1&limit=999`)).json();
    if (apiOver.items.length > 50)
      throw new Error(`/api/anime?limit=999 вернул ${apiOver.items.length} — потолок API (50) не соблюдён`);
    console.log(`  ok  /api/anime отдаёт ровно limit элементов, потолок 50 соблюдён`);

    // ── 2. Родной поиск источника без lib search ───────────────────────────
    console.log('— Родной поиск (lib search выключен) —');
    await page.goto(`${U}?page.kind=anime&page.size=10&page.q=наруто&page.fuzzy=false&${QUIET}`, {
      waitUntil: 'networkidle',
    });
    await page.waitForSelector('[data-paginator-host="demo-url"] [data-testid^="anime-"]');
    const nativeTitles = await titlesOf(page);
    if (!nativeTitles.some((t) => t.includes('Наруто')))
      throw new Error(`родной поиск не нашёл «Наруто»: ${JSON.stringify(nativeTitles)}`);
    if ((await page.locator('[data-testid="search-correction"]').count()) !== 0)
      throw new Error('без lib search не должно быть подписи коррекции');
    if ((await page.locator('[data-testid="search-stats"]').count()) !== 0)
      throw new Error('без lib search не должно быть статистики перехвата');
    const searchBox = page.locator('[data-testid="demo-panel"] input[name="page.search"][type="checkbox"]');
    const fuzzyBox = page.locator('[data-testid="demo-panel"] input[name="page.fuzzy"][type="checkbox"]');
    if (!(await searchBox.isChecked())) throw new Error('опция «Поиск» должна быть включена');
    if (await fuzzyBox.isChecked()) throw new Error('опция fuzzy должна быть выключена адресом');
    console.log(`  ok  бэкенд сузил выдачу подстрокой: ${nativeTitles.slice(0, 3).join(', ')}…`);

    // ── 3. lib search: fuzzy исправляет опечатку ───────────────────────────
    console.log('— lib search (fuzzy-перехват) —');
    await page.goto(`${U}?page.kind=anime&page.size=10&page.q=нарута&page.fuzzy=true&${QUIET}`, {
      waitUntil: 'networkidle',
    });
    // SSR для опечатки отдаёт родную выдачу; клиент пересобирает её через перехват
    await page.waitForSelector('[data-testid="search-correction"]', { timeout: 15000 });
    const note = await page.locator('[data-testid="search-correction"]').innerText();
    if (!note.includes('наруто')) throw new Error(`коррекция не подставила «наруто»: ${note}`);
    const fuzzyCards = await cardsOf(page);
    if (fuzzyCards.length !== 10)
      throw new Error(`перехваченная страница отдала ${fuzzyCards.length} карточек, ожидалось 10`);
    if (!fuzzyCards.includes('anime-20'))
      throw new Error(`lib search не нашёл «Наруто» по опечатке: ${JSON.stringify(fuzzyCards.slice(0, 4))}`);
    const stats = await page.locator('[data-testid="search-stats"]').innerText();
    const scanned = Number(await page.locator('[data-testid="stat-scanned"]').innerText());
    if (!(scanned > 0)) throw new Error(`статистика перехвата не заполнилась: ${stats}`);
    console.log(`  ok  «нарута» исправлена на «наруто», найдено ${fuzzyCards.length} карточек, скачано ${scanned}`);

    // У живого API нет totals: nav источника обязан остаться на стрелках,
    // а не выдумывать номера страниц (R12). Контроль — соседняя галерея,
    // у которой totalItems известен: у неё счётчик «СТР … из …» есть.
    const navText = await page
      .locator('[data-paginator-host="demo-url"] [data-testid="page-nav"]')
      .innerText();
    const navLinks = await page.locator('[data-paginator-host="demo-url"] [data-testid="page-nav"] a').count();
    if (navText.includes('СТР') || navLinks > 2)
      throw new Error(`nav источника выдумала номера страниц: «${navText.replace(/\n/g, ' ')}»`);
    const galleryNav = await page.locator('[data-testid="page-nav"]', { hasText: 'СТР' }).count();
    if (galleryNav < 1)
      throw new Error('контрольный счётчик галереи пропал — сравнивать не с чем');
    console.log('  ok  nav источника — только стрелки (totalItems не выдумывается)');

    // ── 4. Выключатель «Поиск»: поля нет, запрос не учитывается ────────────
    console.log('— Опции панели: выключить поиск и выключить lib/search —');
    await searchBox.evaluate((el) => el.click());
    await page.waitForFunction(
      () => decodeURIComponent(location.search).includes('page.search=false'),
      null,
      { timeout: 10000 },
    );
    if ((await page.locator('[data-testid="search-form"]').count()) !== 0)
      throw new Error('при выключенном поиске поля быть не должно');
    // Запрос не выбрасываем: он остаётся в адресе, но источник его не видит —
    // в панели это сказано прямым текстом, а выдача снова идёт с начала.
    const offNote = await page.locator('[data-testid="search-off"]').innerText();
    if (!offNote.includes('нарута'))
      throw new Error(`подпись «поиск выключен» не называет отброшенный запрос: ${offNote}`);
    if (!decodeURIComponent(page.url()).includes('page.q=нарута'))
      throw new Error(`запрос потерялся из адреса: ${page.url()}`);
    await page.waitForSelector('[data-paginator-host="demo-url"] [data-testid="anime-16498"]');
    const offTitles = await titlesOf(page);
    if (offTitles.length !== 10 || offTitles[0] !== 'Атака титанов')
      throw new Error(`без поиска ожидался обычный каталог: ${JSON.stringify(offTitles.slice(0, 3))}`);
    console.log(`  ok  «Поиск» выключен: поля нет, запрос игнорируется, каталог с начала (${offTitles[0]})`);

    await searchBox.evaluate((el) => el.click());
    await page.waitForSelector('[data-testid="search-form"]');
    // Адрес чистится асинхронно (значение = дефолт → ключ не сериализуется)
    await page.waitForFunction(
      () => !decodeURIComponent(location.search).includes('page.search=false'),
      null,
      { timeout: 10000 },
    );
    await page.waitForSelector('[data-testid="search-correction"]', { timeout: 15000 });
    console.log('  ok  «Поиск» включается обратно — запрос из адреса снова в деле');

    // ── 5. Выключатель lib/search: тот же запрос обслуживает родной поиск ──
    await page.goto(`${U}?page.kind=anime&page.size=10&page.q=нарута&page.fuzzy=true&${QUIET}`, {
      waitUntil: 'networkidle',
    });
    await page.waitForSelector('[data-testid="search-correction"]', { timeout: 15000 });
    await fuzzyBox.evaluate((el) => el.click());
    await page.waitForFunction(
      () => decodeURIComponent(location.search).includes('page.fuzzy=false'),
      null,
      { timeout: 10000 },
    );
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="search-correction"]').length === 0,
      null,
      { timeout: 10000 },
    );
    const nativeAfterToggle = await titlesOf(page);
    if (!nativeAfterToggle.includes('Нарутару'))
      throw new Error(
        `после выключения lib/search ожидалась родная выдача по сырому запросу: ${JSON.stringify(nativeAfterToggle.slice(0, 3))}`,
      );
    console.log('  ok  lib/search выключен — запрос ушёл источнику как есть («нарута» → Нарутару)');
    await fuzzyBox.evaluate((el) => el.click());
    await page.waitForSelector('[data-testid="search-correction"]', { timeout: 15000 });
    console.log('  ok  lib/search включается обратно — опечатка снова исправляется');

    // ── 6. Поле поиска и адрес ─────────────────────────────────────────────
    console.log('— Форма поиска —');
    await page.goto(`${U}?page.kind=anime&page.size=10&${QUIET}`, { waitUntil: 'networkidle' });
    await page.fill('[data-testid="search-input"]', 'тетрадь');
    await page.click('[data-testid="search-submit"]');
    await page.waitForFunction(
      () => decodeURIComponent(location.search).includes('page.q=тетрадь'),
      null,
      { timeout: 10000 },
    );
    await page.waitForSelector('[data-paginator-host="demo-url"] [data-testid^="anime-"]');
    const typedTitles = await titlesOf(page);
    if (!typedTitles.some((t) => t.includes('Тетрадь смерти')))
      throw new Error(`поиск из формы не нашёл «Тетрадь смерти»: ${JSON.stringify(typedTitles.slice(0, 3))}`);
    if (!decodeURIComponent(page.url()).includes('page.q=тетрадь'))
      throw new Error(`запрос не сериализован в адрес: ${page.url()}`);
    console.log(`  ok  форма положила запрос в адрес и выдачу (${typedTitles[0]})`);

    await page.click('[data-testid="search-clear"]');
    await page.waitForFunction(() => !decodeURIComponent(location.search).includes('page.q='), null, {
      timeout: 10000,
    });
    console.log('  ok  «сбросить» очищает запрос и адрес');

    // ── 7. Пагинация: страницы выдачи не повторяются ───────────────────────
    console.log('— Страницы выдачи —');
    await page.goto(`${U}?page.kind=anime&page.size=5&page.q=наруто&page.fuzzy=false&${QUIET}`, {
      waitUntil: 'networkidle',
    });
    await page.waitForSelector('[data-paginator-host="demo-url"] [data-testid^="anime-"]');
    const page1 = await cardsOf(page);
    await page.goto(`${U}?page.kind=anime&page.size=5&page.q=наруто&page.fuzzy=false&page=2&${QUIET}`, {
      waitUntil: 'networkidle',
    });
    await page.waitForSelector('[data-paginator-host="demo-url"] [data-testid^="anime-"]');
    const page2 = await cardsOf(page);
    if (page2.length !== 5) throw new Error(`страница 2 отдала ${page2.length} карточек, ожидалось 5`);
    const overlap = page1.filter((id) => page2.includes(id));
    if (overlap.length)
      throw new Error(`страницы выдачи пересекаются: ${JSON.stringify(overlap)}`);
    console.log(`  ok  страница 2 не повторяет страницу 1 (${page2[0]}… против ${page1[0]}…)`);

    if (process.env.SEARCH_KEEP) await sleep(400);
  } finally {
    await browser.close();
    killServer();
  }
}

run()
  .then(() => {
    console.log('\nsearch: PASS (SSR каталога + родной поиск + lib/search + выключатели + страницы)');
  })
  .catch((error) => {
    console.error(`\nsearch: FAIL\n${error?.stack ?? error}`);
    process.exitCode = 1;
  });
