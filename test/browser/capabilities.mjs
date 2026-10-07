/**
 * Сквозная проверка ЭТАПОВ 1–2 на объединённом дереве: возможности источника —
 * единственный источник правды для UI, а не «мёртвые» ключи адреса.
 *
 * Что проверяется в браузере (и чего нет в paginate.mjs/shikimori.mjs):
 *   1. товары: оба слоя поиска (родной `srch` + `ls`) — возможности ИСТОЧНИКА;
 *      запрос обслуживается родным контуром, а с включённым lib/search панель
 *      показывает живую статистику перехвата (общий канал lib/search);
 *   2. фото: поиска нет — поле ВИДНО выключенным И С ПРИЧИНОЙ, тумблеры панели
 *      выключены с причиной;
 *   3. решение владельца 2026-10-07: «мёртвые» ключи НЕ снимаются — запрос и
 *      значение опции остаются и в адресе, и в записи localStorage (источник их
 *      просто не применяет), а выключенный тумблер не пишет ничего нового.
 *
 * ⚠️ Пункт 2/3 ходят в живой Shikimori только при переключении на него; этот
 * файл живёт на локальных источниках (товары/фото) — сеть не нужна, кроме
 * загрузки страницы. Запуск:
 *   MODALS_PORT=4173 node test/browser/capabilities.mjs
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = Number(process.env.MODALS_PORT ?? process.env.PORT ?? 4173);
const U = process.env.CAPABILITIES_BASE ?? `http://127.0.0.1:${PORT}/paginator`;

/** Ключи пагинатора, глушащие автоподгрузку: считаем ровно одну страницу. */
const QUIET = 'page.topTrigger=off&page.bottomTrigger=off';
const HOST = '[data-paginator-host="demo-url"]';

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
  for (let i = 0; i < 40; i++) {
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

const params = (page) => new URLSearchParams(new URL(page.url()).search);
const search = (page) => decodeURIComponent(new URL(page.url()).search);

const idsOf = (page, kind) =>
  page.$$eval(
    `${HOST} [data-testid]`,
    (els, re) => {
      const rx = new RegExp(re);
      return els.map((el) => el.getAttribute('data-testid')).filter((t) => rx.test(t));
    },
    kind === 'photos' ? '^photo-\\d+$' : '^card-\\d+$',
  );

const panel = (page, key) =>
  page.locator(`[data-testid="demo-panel"] input[type="checkbox"][name="page.${key}"]`);

/**
 * Переключение опции: клик по САМОМУ input'у через `evaluate` — так делает и
 * paginate.mjs (у Ark-Switch поле визуально скрыто, обычный клик не проходит).
 */
const toggle = (page, key) => panel(page, key).evaluate((el) => el.click());

const urlHas = (page, key, value) =>
  page.waitForFunction(
    ([k, v]) => new URLSearchParams(location.search).get(k) === v,
    [key, value],
    { timeout: 15000 },
  );

const fieldHints = (page) =>
  page.$$eval('[data-field-hint]', (els) => els.map((el) => el.textContent.trim()));

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/** Переключение источника — обычный выбор панели (ключ `src`). */
async function switchSource(page, src) {
  await page.selectOption('select[name="page.src"]', src);
  await page.waitForFunction(
    (s) => new URLSearchParams(location.search).get('page.src') === s,
    src,
    { timeout: 15000 },
  );
}

async function run() {
  await ensureServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });

    // ── 1. Товары: оба слоя поиска — возможности источника ─────────────────
    console.log('— Товары: родной поиск + lib/search —');
    await page.goto(`${U}?page.src=products&page.size=5&${QUIET}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`${HOST} [data-testid="card-1"]`);

    const input = page.locator('[data-testid="search-input"]');
    assert(!(await input.isDisabled()), 'у товаров поле запроса обязано быть активно');
    assert(!(await panel(page, 'srch').isDisabled()), 'родной поиск товаров доступен');
    assert(!(await panel(page, 'ls').isDisabled()), 'lib/search поверх товаров доступен');
    assert(
      (await page.locator(`${HOST} [data-field-hint]`).count()) === 0,
      'причины отказа быть не должно: у источника есть оба слоя',
    );

    // Родной контур (lib/search по умолчанию выключен): запрос обслуживает сам
    // источник — подстрока по названию, регистр не важен.
    await input.fill('PRODUCT 42');
    await input.press('Enter');
    await urlHas(page, 'page.q', 'PRODUCT 42');
    await page.waitForSelector(`${HOST} [data-testid="card-42"]`);
    const nativeIds = await idsOf(page, 'products');
    assert(
      nativeIds.join(',') === 'card-42',
      `родной поиск обязан отдать ровно «Product 42»: ${JSON.stringify(nativeIds)}`,
    );
    // Тулбар показывает состояние ОБОИХ слоёв: родной поиск включён, lib/search выключен.
    assert(
      (await page.locator('[data-testid="search-native"]').innerText()) === 'вкл',
      'родной слой обязан быть показан включённым',
    );
    assert(
      (await page.locator('[data-testid="search-ls"]').innerText()) === 'выкл',
      'lib/search по умолчанию выключен — тулбар это отражает',
    );
    assert(
      (await page.locator('[data-testid="search-stats"]').count()) === 0,
      'без lib/search живых счётчиков перехвата быть не должно',
    );
    const size = (await page.locator('[data-testid="page-size"]').textContent()).trim();
    assert(size === '5', `размер страницы потерян при поиске: «${size}»`);
    console.log(`  ok  «PRODUCT 42» → ${nativeIds.join(', ')} (регистр не важен, подстрока)`);

    // lib/search включён: другой контур того же запроса + живая статистика
    // перехвата из ОБЩЕГО канала lib/search (панель её не считает сама).
    await toggle(page, 'ls');
    await urlHas(page, 'page.ls', 'true');
    await page.waitForSelector(`${HOST} [data-testid="card-42"]`, { timeout: 30000 });
    await page.waitForSelector('[data-testid="search-stats"]', { timeout: 30000 });
    const stats = await page.locator('[data-testid="search-stats"]').innerText();
    assert(
      /просмотрено \d+, совпало \d+, выдано \d+/.test(stats),
      `статистика перехвата не заполнилась: «${stats}»`,
    );
    assert(
      (await page.locator('[data-testid="search-ls"]').innerText()) === 'вкл',
      'тулбар обязан отметить включённый lib/search',
    );
    console.log(`  ok  тот же запрос с lib/search: ${stats.trim()}`);

    // ── 2. Фото: поиска нет — поле выключено с причиной, ключи ОСТАЮТСЯ ────
    console.log('— Фото: источник без поиска (ключи не снимаются) —');
    await switchSource(page, 'photos');
    await page.waitForSelector(`${HOST} [data-testid="photo-1"]`);

    const url = params(page);
    assert(
      url.get('page.q') === 'PRODUCT 42',
      `запрос обязан ОСТАТЬСЯ в адресе (решение 2026-10-07): ${search(page)}`,
    );
    assert(
      url.get('page.ls') === 'true',
      `значение опции тоже остаётся: ${search(page)}`,
    );
    assert(url.get('page.src') === 'photos', `выбор источника не записался: ${search(page)}`);

    assert(await input.isDisabled(), 'поле запроса обязано быть выключенным');
    assert(await page.locator('[data-testid="search-submit"]').isDisabled(), 'кнопка тоже выключена');
    const title = await input.getAttribute('title');
    assert(
      /не поддерживает поиск/.test(title ?? ''),
      `у выключенного поля нет причины в title: «${title}»`,
    );
    const hints = await fieldHints(page);
    assert(
      hints.some((h) => /не поддерживает поиск/.test(h)),
      `причина не показана рядом с полем: ${JSON.stringify(hints)}`,
    );

    const offSrch = panel(page, 'srch');
    const offLs = panel(page, 'ls');
    assert(await offSrch.isDisabled(), 'тумблер «родной поиск» обязан быть выключен');
    assert(await offLs.isDisabled(), 'тумблер «lib/search» обязан быть выключен');
    assert(
      hints.some((h) => /источник не поддерживает/.test(h)),
      `в панели нет причины отказа: ${JSON.stringify(hints)}`,
    );
    const prose = await page.locator('[data-testid="search-hint"]').innerText();
    assert(/не умеет искать/.test(prose), `подсказка под формой не объясняет случай: «${prose}»`);

    // Выключенный тумблер ничего не пишет: адрес не меняется от клика по нему.
    const before = search(page);
    await offSrch.click({ force: true }).catch(() => {});
    await sleep(250);
    assert(
      search(page) === before,
      `адрес изменился от клика по выключенному тумблеру: ${search(page)}`,
    );
    const photoIds = await idsOf(page, 'photos');
    assert(
      photoIds.length >= 1 && photoIds[0] === 'photo-1',
      `выдача обязана быть несужённым списком фото: ${JSON.stringify(photoIds.slice(0, 3))}`,
    );
    console.log(
      `  ok  поле выключено с причиной, ключи живы: q=${url.get('page.q')} / ls=${url.get('page.ls')}`,
    );

    // ── 3. То же в localStorage: «мёртвые» ключи остаются в записи ─────────
    console.log('— Переключение источника в localStorage-хранилище —');
    await page.goto(`${U}?page.size=5&${QUIET}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`${HOST} [data-testid="card-1"]`);
    await page.selectOption('select[name="store"]', 'local');
    await page.waitForFunction(() => location.pathname.endsWith('/paginator'), null, {
      timeout: 15000,
    });
    await page.waitForSelector(`[data-paginator-host="demo-local-ls"] [data-testid="card-1"]`);
    await page.locator('[data-testid="search-input"]').fill('product 7');
    await page.locator('[data-testid="search-input"]').press('Enter');
    await page.waitForFunction(
      () => {
        const raw = localStorage.getItem('pag:demo-local-ls');
        return raw ? JSON.parse(raw).extra?.q === 'product 7' : false;
      },
      null,
      { timeout: 15000 },
    );
    // В localStorage-хранилище адрес ни при чём: переключаем селект напрямую
    // и ждём саму запись, а не URL.
    await page.selectOption('select[name="page.src"]', 'photos');
    await page.waitForSelector('[data-paginator-host="demo-local-ls"] [data-testid="photo-1"]');
    await page.waitForFunction(
      () => {
        const raw = localStorage.getItem('pag:demo-local-ls');
        if (!raw) return false;
        const extra = JSON.parse(raw).extra ?? {};
        return extra.src === 'photos' && extra.q === 'product 7';
      },
      null,
      { timeout: 15000 },
    );
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pag:demo-local-ls')));
    assert(
      saved.page === 1,
      `смена источника обязана вернуть страницу 1, а не ${saved.page}`,
    );
    console.log(`  ok  localStorage: src=photos, запрос цел, страница ${saved.page}`);

    console.log('\n✅ Этапы 1–2: возможности источника правят UI, причины видны, мёртвые ключи живы');
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
