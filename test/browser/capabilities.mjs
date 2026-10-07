/**
 * Сквозная проверка ЭТАПА 1: пагинатор принимает только адаптированные источники,
 * всегда знает их возможности, а UI (тулбар и демо-панель) выключает то, чего у
 * текущего источника нет — с видимой причиной и без записи «мёртвых» ключей.
 *
 * Что проверяется в браузере:
 *   1. маркер `source-capabilities` отдаёт возможности ТЕКУЩЕГО выбора;
 *   2. у источника без поиска (товары/фото) поле поиска ВИДНО, но выключено, и
 *      причина написана; в панели выключены тумблеры «Поиск» и «lib/search»;
 *   3. выключенное поле не пишет ключ: ни в адрес, ни скрытым полем GET-формы;
 *   4. у каталога Shikimori поиск и lib/search есть, а числа страниц нет — маркер
 *      и панель это отражают без ручных списков;
 *   5. переключение источника снимает ключи, которых у нового выбора нет, ЧЕРЕЗ
 *      ХРАНИЛИЩЕ: адрес (URL) и localStorage теряют `page.q`/`page.fuzzy` — и это
 *      одна запись (одна перезагрузка страницы 1), а не вторая правка втихую.
 *
 * ⚠️ Тест ходит в живой Shikimori API через наш бэкенд (пункт про каталог) и
 * требует сети. Запуск:
 *   MODALS_PORT=4173 node test/browser/capabilities.mjs
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = Number(process.env.MODALS_PORT ?? process.env.PORT ?? 4173);
const U = process.env.CAPABILITIES_BASE ?? `http://127.0.0.1:${PORT}/paginator`;

const QUIET = 'page.topTrigger=off&page.bottomTrigger=off';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isServerUp(url) {
  try {
    const res = await fetch(url);
    return res.status < 500;
  } catch {
    return false;
  }
}

let serverProc = null;

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

const search = (page) => decodeURIComponent(new URL(page.url()).search);

/** Возможности текущего источника — так их видит UI (маркер пагинатора). */
const capsOf = async (page) => {
  const el = await page.waitForSelector('[data-testid="source-capabilities"]');
  return el.evaluate((node) => ({
    source: node.getAttribute('data-source'),
    search: node.getAttribute('data-search'),
    fuzzy: node.getAttribute('data-fuzzy'),
    filters: node.getAttribute('data-filters'),
    totals: node.getAttribute('data-totals'),
  }));
};

const idsOf = (page, kind) =>
  page.$$eval('[data-paginator-host="demo-url"] [data-testid]', (els, re) => {
    const rx = new RegExp(re);
    return els.map((el) => el.getAttribute('data-testid')).filter((t) => rx.test(t));
  }, kind === 'photos' ? '^photo-\\d+$' : kind === 'anime' ? '^anime-\\d+$' : '^card-\\d+$');

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function run() {
  await ensureServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });

    // ── 1. Источник без поиска: поле видно, выключено, с причиной ─────────
    console.log('— Товары: поиска у источника нет —');
    await page.goto(`${U}?page.size=5&${QUIET}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="card-1"]');
    const products = await capsOf(page);
    assert(products.source === 'products', `маркер назвал источник «${products.source}»`);
    assert(products.search === 'off', 'у товаров поиска быть не должно (этап 1)');
    assert(products.fuzzy === 'off', 'lib/search без поиска источника невозможен');
    assert(products.filters === 'off', 'фильтров у товаров нет');
    assert(products.totals === 'on', 'товары отдают число страниц');

    const input = page.locator('[data-testid="search-input"]');
    assert((await input.count()) === 1, 'поле поиска должно быть ВИДНО (выключенное не прячем)');
    assert(await input.isDisabled(), 'поле поиска обязано быть выключенным');
    assert(await page.locator('[data-testid="search-submit"]').isDisabled(), 'кнопка тоже выключена');
    const note = await page.locator('[data-testid="search-unsupported"]').textContent();
    assert(/не поддерживает поиск/.test(note), `причина не написана: «${note.trim()}»`);
    console.log(`  ok  поле выключено и объяснено: «${note.trim()}»`);

    const panelSearch = page.locator('input[type="checkbox"][name="page.search"]');
    const panelFuzzy = page.locator('input[type="checkbox"][name="page.fuzzy"]');
    assert(await panelSearch.isDisabled(), 'тумблер «Поиск» в панели обязан быть выключен');
    assert(await panelFuzzy.isDisabled(), 'тумблер «lib/search» в панели обязан быть выключен');
    const hints = await page.$$eval('[data-field-hint]', (els) => els.map((e) => e.textContent));
    assert(
      hints.some((h) => /источник не поддерживает поиск/.test(h)),
      `в панели нет причины отказа: ${JSON.stringify(hints)}`,
    );
    assert(
      (await page.locator('input[type="hidden"][name="page.search"]').count()) === 0,
      'выключенный параметр не должен попадать в GET-форму без JS',
    );
    assert(
      (await page.locator('input[type="hidden"][name="page.fuzzy"]').count()) === 0,
      'выключенный lib/search тоже не пишется без JS',
    );
    console.log('  ok  панель выключила «Поиск» и «lib/search» и объяснила причину');

    // Выключенное не пишется и через JS: жмём disabled-тумблер — адрес не меняется.
    const before = search(page);
    await panelSearch.click({ force: true }).catch(() => {});
    await sleep(200);
    assert(search(page) === before, `адрес изменился от клика по выключенному тумблеру: ${search(page)}`);
    console.log('  ok  клик по выключенному тумблеру адрес не трогает');

    // ── 2. Каталог Shikimori: поиск есть, числа страниц нет ───────────────
    console.log('— Аниме: возможности источника другие —');
    await page.selectOption('select[name="page.kind"]', 'anime');
    await page.waitForFunction(
      () => decodeURIComponent(location.search).includes('page.kind=anime'),
      null,
      { timeout: 10000 },
    );
    await page.waitForSelector('[data-testid^="anime-"]');
    const anime = await capsOf(page);
    assert(anime.search === 'on' && anime.fuzzy === 'on', `поиск каталога не объявлен: ${JSON.stringify(anime)}`);
    assert(anime.totals === 'off', 'у API Shikimori нет общего числа записей');
    assert(!(await page.locator('[data-testid="search-input"]').isDisabled()), 'поле поиска обязано включиться');
    assert(!(await panelSearch.isDisabled()), 'тумблер «Поиск» обязан включиться');
    assert(!(await panelFuzzy.isDisabled()), 'тумблер «lib/search» обязан включиться');
    assert(
      (await page.locator('[data-testid="search-unsupported"]').count()) === 0,
      'у источника с поиском причины отказа быть не должно',
    );
    console.log('  ok  маркер и панель переключились вместе с источником');

    // ── 3. Переключение источника чистит ключи через URL ──────────────────
    console.log('— Переключение источника: ключи уходят через хранилище —');
    await page.goto(`${U}?page.kind=anime&page.size=5&page.q=наруто&page.fuzzy=true&${QUIET}`, {
      waitUntil: 'networkidle',
    });
    await page.waitForSelector('[data-testid^="anime-"]');
    assert(search(page).includes('page.q='), 'подготовка: запрос должен быть в адресе');
    await page.selectOption('select[name="page.kind"]', 'photos');
    await page.waitForFunction(
      () => decodeURIComponent(location.search).includes('page.kind=photos'),
      null,
      { timeout: 10000 },
    );
    await page.waitForSelector('[data-testid^="photo-"]');
    const url = search(page);
    assert(!url.includes('page.q='), `page.q обязан уйти из адреса вместе с источником: ${url}`);
    assert(!url.includes('page.fuzzy='), `page.fuzzy обязан уйти: ${url}`);
    assert(!url.includes('page.search='), `page.search обязан уйти: ${url}`);
    const photos = await capsOf(page);
    assert(photos.search === 'off' && photos.totals === 'on', `фото — только данные: ${JSON.stringify(photos)}`);
    const photoIds = await idsOf(page, 'photos');
    assert(
      photoIds.length >= 1 && photoIds[0] === 'photo-1',
      `выдача обязана быть несужённым списком фото, а не поиском: ${JSON.stringify(photoIds.slice(0, 3))}`,
    );
    console.log(`  ok  адрес после переключения: ${url || '(без ключей)'}`);

    // ── 4. Тот же контур через localStorage ──────────────────────────────
    console.log('— Переключение источника: чистка в localStorage —');
    await page.goto(`${U}?page.size=5&${QUIET}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="card-1"]');
    await page.selectOption('select[name="store"]', 'local');
    await page.waitForFunction(() => location.pathname.endsWith('/paginator'), null, { timeout: 10000 });
    await page.waitForSelector('[data-testid^="card-"]');
    await page.selectOption('select[name="page.kind"]', 'anime');
    await page.waitForSelector('[data-testid^="anime-"]');
    await page.fill('[data-testid="search-input"]', 'наруто');
    await page.click('[data-testid="search-submit"]');
    await page.waitForFunction(
      () => {
        const raw = localStorage.getItem('pag:demo-local-ls');
        return raw ? JSON.parse(raw).extra?.q === 'наруто' : false;
      },
      null,
      { timeout: 10000 },
    );
    console.log('  ok  запрос лёг в localStorage вместе с источником (anime)');

    await page.selectOption('select[name="page.kind"]', 'photos');
    await page.waitForFunction(
      () => {
        const raw = localStorage.getItem('pag:demo-local-ls');
        if (!raw) return false;
        const extra = JSON.parse(raw).extra ?? {};
        return extra.kind === 'photos' && !('q' in extra) && !('fuzzy' in extra);
      },
      null,
      { timeout: 10000 },
    );
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pag:demo-local-ls')));
    assert(saved.page === 1, `смена данных обязана вернуть страницу 1, а не ${saved.page}`);
    assert(!('search' in (saved.extra ?? {})) || saved.extra.search !== false, 'мусорный ключ остался в хранилище');
    console.log(
      `  ok  localStorage: extra = ${JSON.stringify(saved.extra)}, страница ${saved.page}, без q/fuzzy`,
    );

    console.log('\n✅ Этап 1: возможности источника управляют UI, ключи чистятся хранилищем');
  } finally {
    await browser.close();
    killServer();
  }
}

run().catch((error) => {
  console.error('\ncapabilities: FAIL');
  console.error(error);
  process.exitCode = 1;
});
