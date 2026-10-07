/**
 * Сквозная проверка ЭТАПОВ 1–2: пагинатор принимает только адаптированные
 * источники, всегда знает их возможности, а UI (тулбар и демо-панель) выключает
 * то, чего у текущего источника нет — с видимой причиной и без записи «мёртвых»
 * ключей.
 *
 * Что проверяется в браузере:
 *   1. товары: поиск по названию (подстрока без учёта регистра) и lib/search —
 *      возможности источника, а не тумблеры демо; форма, адрес и выдача согласованы;
 *   2. переключение на фото: у источника нет поиска → поле ВИДНО выключенным с
 *      причиной, тумблеры панели выключены, а ключи `page.q`/`page.fuzzy`/`page.search`
 *      снимаются ЧЕРЕЗ ХРАНИЛИЩЕ (адрес, а в другом сценарии — localStorage);
 *   3. каталог Shikimori: поиск и lib/search есть, числа страниц нет — маркер и
 *      панель это отражают без ручных списков.
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
  page.$$eval(
    '[data-paginator-host="demo-url"] [data-testid]',
    (els, re) => {
      const rx = new RegExp(re);
      return els.map((el) => el.getAttribute('data-testid')).filter((t) => rx.test(t));
    },
    kind === 'photos' ? '^photo-\\d+$' : kind === 'anime' ? '^anime-\\d+$' : '^card-\\d+$',
  );

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function switchKind(page, kind) {
  await page.selectOption('select[name="page.kind"]', kind);
  await page.waitForFunction(
    (k) => decodeURIComponent(location.search).includes(`page.kind=${k}`),
    kind,
    { timeout: 10000 },
  );
}

async function run() {
  await ensureServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });

    // ── 1. Товары: поиск есть, и он — возможность источника ──────────────
    console.log('— Товары: родной поиск по названию + lib/search —');
    await page.goto(`${U}?page.size=5&${QUIET}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="card-1"]');
    const products = await capsOf(page);
    assert(products.source === 'products', `маркер назвал источник «${products.source}»`);
    assert(products.search === 'on', `у товаров обязан быть поиск: ${JSON.stringify(products)}`);
    assert(products.fuzzy === 'on', 'lib/search может встать поверх родного поиска товаров');
    assert(products.filters === 'off', 'фильтров у товаров пока нет');
    assert(products.totals === 'on', 'товары отдают число страниц');
    assert(
      !(await page.locator('[data-testid="search-input"]').isDisabled()),
      'поле поиска товаров обязано быть включено',
    );
    assert(
      (await page.locator('[data-testid="search-unsupported"]').count()) === 0,
      'причины отказа быть не должно: поиск поддерживается',
    );

    // Родной контур: тумблер панели выключает lib/search — запрос обслуживает
    // сам источник (подстрока по названию, регистр не важен).
    const panelSearch = page.locator('input[type="checkbox"][name="page.search"]');
    const panelFuzzy = page.locator('input[type="checkbox"][name="page.fuzzy"]');
    assert(!(await panelSearch.isDisabled()), 'у источника с поиском тумблер «Поиск» включён');
    assert(!(await panelFuzzy.isDisabled()), 'у источника с поиском тумблер «lib/search» включён');
    // Родной контур: тумблер панели выключает lib/search — запрос обслуживает
    // сам источник (подстрока по названию, регистр не важен).
    await panelFuzzy.uncheck();
    await page.waitForFunction(
      () => decodeURIComponent(location.search).includes('page.fuzzy=false'),
      null,
      { timeout: 10000 },
    );
    await page.fill('[data-testid="search-input"]', 'PRODUCT 42');
    await page.click('[data-testid="search-submit"]');
    await page.waitForFunction(
      () => decodeURIComponent(location.search).includes('page.q='),
      null,
      { timeout: 10000 },
    );
    await page.waitForSelector('[data-paginator-host="demo-url"] [data-testid="card-42"]');
    const nativeIds = await idsOf(page, 'products');
    assert(
      nativeIds.join(',') === 'card-42',
      `родной поиск обязан отдать ровно «Product 42»: ${JSON.stringify(nativeIds)}`,
    );
    const size = await page.locator('[data-testid="page-size"]').textContent();
    assert(size.trim() === '5', `размер страницы потерян при поиске: «${size}»`);
    assert(
      (await page.locator('[data-testid="search-native"]').count()) === 1,
      'с выключенным lib/search тулбар обязан сказать, кто обслуживает запрос',
    );
    console.log(`  ok  «PRODUCT 42» → ${nativeIds.join(', ')} (регистр не важен, подстрока)`);

    // Тот же запрос, но с lib/search: возможность та же, контур другой — выдача
    // не должна «потерять» найденное.
    await panelFuzzy.check();
    await page.waitForFunction(
      () => !decodeURIComponent(location.search).includes('page.fuzzy=false'),
      null,
      { timeout: 10000 },
    );
    await page.waitForSelector('[data-paginator-host="demo-url"] [data-testid="card-42"]');
    assert(
      (await page.locator('[data-testid="search-native"]').count()) === 0,
      'с включённым lib/search подпись «родной контур» лишняя',
    );
    console.log('  ok  тот же запрос с включённым lib/search: Product 42 на месте');

    // ── 2. Фото: возможности нет — поле выключено, ключи уходят в хранилище ─
    console.log('— Фото: источник без поиска —');
    await switchKind(page, 'photos');
    await page.waitForSelector('[data-paginator-host="demo-url"] [data-testid="photo-1"]');
    const url = search(page);
    assert(!url.includes('page.q='), `page.q обязан уйти из адреса вместе с источником: ${url}`);
    assert(!url.includes('page.fuzzy='), `page.fuzzy обязан уйти: ${url}`);
    assert(!url.includes('page.search='), `page.search обязан уйти: ${url}`);
    const photos = await capsOf(page);
    assert(
      photos.search === 'off' && photos.fuzzy === 'off' && photos.totals === 'on',
      `фото — только данные: ${JSON.stringify(photos)}`,
    );
    const photoIds = await idsOf(page, 'photos');
    assert(
      photoIds.length >= 1 && photoIds[0] === 'photo-1',
      `выдача обязана быть несужённым списком фото: ${JSON.stringify(photoIds.slice(0, 3))}`,
    );

    const input = page.locator('[data-testid="search-input"]');
    assert((await input.count()) === 1, 'поле поиска должно быть ВИДНО (выключенное не прячем)');
    assert(await input.isDisabled(), 'поле поиска обязано быть выключенным');
    assert(await page.locator('[data-testid="search-submit"]').isDisabled(), 'кнопка тоже выключена');
    const note = await page.locator('[data-testid="search-unsupported"]').textContent();
    assert(/не поддерживает поиск/.test(note), `причина не написана: «${note.trim()}»`);

    const offSearch = page.locator('input[type="checkbox"][name="page.search"]');
    const offFuzzy = page.locator('input[type="checkbox"][name="page.fuzzy"]');
    assert(await offSearch.isDisabled(), 'тумблер «Поиск» в панели обязан быть выключен');
    assert(await offFuzzy.isDisabled(), 'тумблер «lib/search» в панели обязан быть выключен');
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
    const before = search(page);
    await offSearch.click({ force: true }).catch(() => {});
    await sleep(200);
    assert(search(page) === before, `адрес изменился от клика по выключенному тумблеру: ${search(page)}`);
    console.log(`  ok  поле выключено с причиной, тумблеры выключены, ключи сняты: ${url || '(пусто)'}`);

    // ── 3. Каталог Shikimori: поиск есть, числа страниц нет ───────────────
    console.log('— Аниме: возможности источника другие —');
    await switchKind(page, 'anime');
    await page.waitForSelector('[data-testid^="anime-"]');
    const anime = await capsOf(page);
    assert(
      anime.search === 'on' && anime.fuzzy === 'on',
      `поиск каталога не объявлен: ${JSON.stringify(anime)}`,
    );
    assert(anime.totals === 'off', 'у API Shikimori нет общего числа записей');
    assert(
      !(await page.locator('[data-testid="search-input"]').isDisabled()),
      'поле поиска обязано включиться',
    );
    assert(!(await offSearch.isDisabled()), 'тумблер «Поиск» обязан включиться');
    assert(!(await offFuzzy.isDisabled()), 'тумблер «lib/search» обязан включиться');
    assert(
      (await page.locator('[data-testid="search-unsupported"]').count()) === 0,
      'у источника с поиском причины отказа быть не должно',
    );
    console.log('  ok  маркер и панель переключились вместе с источником');

    // ── 4. Тот же контур чистки через localStorage ───────────────────────
    console.log('— Переключение источника: чистка в localStorage —');
    // Источник данных — localStorage: адрес тут ни при чём, ключи живут в записи.
    await page.goto(`${U}?page.size=5&${QUIET}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="card-1"]');
    await page.selectOption('select[name="store"]', 'local');
    await page.waitForFunction(
      () => location.pathname.endsWith('/paginator'),
      null,
      { timeout: 10000 },
    );
    await page.waitForSelector('[data-testid^="card-"]');
    await page.fill('[data-testid="search-input"]', 'product 7');
    await page.click('[data-testid="search-submit"]');
    await page.waitForFunction(
      () => {
        const raw = localStorage.getItem('pag:demo-local-ls');
        return raw ? JSON.parse(raw).extra?.q === 'product 7' : false;
      },
      null,
      { timeout: 10000 },
    );
    console.log('  ok  запрос лёг в localStorage вместе с источником (товары)');

    // Переключение источника в localStorage-хранилище (адрес не меняется вовсе).
    await page.selectOption('select[name="page.kind"]', 'photos');
    await page.waitForSelector('[data-testid^="photo-"]');
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
    console.log(`  ok  localStorage: extra без q/fuzzy, страница ${saved.page}`);

    console.log('\n✅ Этапы 1–2: возможности источника управляют UI, ключи чистятся хранилищем');
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
