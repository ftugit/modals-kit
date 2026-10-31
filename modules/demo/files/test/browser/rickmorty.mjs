/**
 * Живой источник Rick and Morty (F54) — REST и GraphQL как две версии одного
 * источника демо-пагинатора:
 *
 *  1. Эндпоинт: размер 5, страница 3 у обеих версий = записи 11..15 первой
 *     страницы API (подгонка фиксированных 20 на страницу), фильтры и поиск
 *     дают одинаковую выдачу в REST и GraphQL;
 *  2. SSR и без JS: `?page.filters.status=alive&page.q=rick` — персонажи и форма
 *     фильтров уже в разметке;
 *  3. Переключение REST ↔ GraphQL в панели: фильтры и запрос остаются в адресе,
 *     выдача та же; опция курсора недоступна (курсора у API нет), номера
 *     страниц есть (API отдаёт count);
 *  4. Панель фильтров следует источнику: после переключения на БД её нет.
 *
 * Сетевой тест (ходит на rickandmortyapi.com) — отдельным файлом, вне оффлайн-набора.
 * Запуск: MODALS_PORT=5173 node test/browser/rickmorty.mjs
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = Number(process.env.MODALS_PORT ?? process.env.PORT ?? 5173);
const BASE = process.env.MODALS_BASE ?? `http://127.0.0.1:${PORT}`;
const U = `${BASE}/paginator`;
const OPTS = 'page.mode=single&page.topTrigger=off&page.bottomTrigger=off&page.size=5';
const FILTERED = 'page.filters.status=alive&page.q=rick';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let serverProc = null;

async function isServerUp(url) {
  try {
    return (await fetch(url)).status < 500;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await isServerUp(U)) return;
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
  if (serverProc?.pid) {
    try {
      process.kill(-serverProc.pid, 'SIGKILL');
    } catch {}
  }
}

async function waitFor(fn, { timeout = 20000, every = 250, what = 'условие' } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > until) throw new Error(`Таймаут ожидания: ${what}`);
    await sleep(every);
  }
}

const ids = (page) => page.items.map((item) => item.id);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function checkApi() {
  console.log('— Эндпоинт: окно страницы и одинаковая выдача REST/GraphQL —');
  const upstream = await fetch('https://rickandmortyapi.com/api/character/?page=1').then((r) => r.json());
  const expected = upstream.results.slice(10, 15).map((item) => item.id);
  for (const api of ['rest', 'graphql']) {
    const page = await fetch(`${BASE}/api/rickmorty/characters?api=${api}&page=3&limit=5`).then((r) => r.json());
    if (!same(ids(page), expected)) throw new Error(`${api}: стр. 3 по 5 = ${ids(page)}, ожидалось ${expected}`);
    if (page.totalItems !== upstream.info.count) throw new Error(`${api}: totalItems ${page.totalItems} ≠ count ${upstream.info.count}`);
  }
  console.log(`  ok  стр. 3 по 5 у обеих версий = записи 11..15 первой страницы API (${expected.join(',')})`);

  const q = 'page=1&limit=20&search=rick&filters.status=alive';
  const [rest, gql] = await Promise.all(
    ['rest', 'graphql'].map((api) => fetch(`${BASE}/api/rickmorty/characters?api=${api}&${q}`).then((r) => r.json())),
  );
  if (!rest.items.length || !same(ids(rest), ids(gql)) || rest.totalItems !== gql.totalItems)
    throw new Error(`фильтр+поиск: REST ${ids(rest)} (${rest.totalItems}) ≠ GraphQL ${ids(gql)} (${gql.totalItems})`);
  if (!rest.items.every((item) => item.status === 'Alive' && /rick/i.test(item.name)))
    throw new Error('фильтр+поиск: в выдаче есть не живые или не «rick»');
  console.log(`  ok  status=alive + «rick»: REST и GraphQL — одни и те же ${rest.totalItems} персонажей`);

  const empty = await fetch(`${BASE}/api/rickmorty/characters?api=rest&search=zzzzqqq`);
  const emptyBody = await empty.json();
  if (empty.status !== 200 || emptyBody.items.length !== 0) throw new Error('пустая выдача REST должна быть 200 и []');
  console.log('  ok  пустая выдача (у REST это 404 сервиса) — пустая страница, не ошибка');
}

async function checkSsr(browser) {
  console.log('— SSR и без JS —');
  const html = await fetch(`${U}?page.src=rm-rest&${OPTS}&${FILTERED}`).then((r) => r.text());
  const rows = [...html.matchAll(/data-testid="rm-(\d+)"/g)];
  if (rows.length !== 5) throw new Error(`SSR: ожидалось 5 персонажей в разметке, найдено ${rows.length}`);
  if (!html.includes('name="page.filters.status"')) throw new Error('SSR: нет формы фильтров в разметке');
  console.log('  ok  5 персонажей и форма фильтров уже в HTML');

  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(`${U}?page.src=rm-graphql&${OPTS}`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="filters-toggle"]').click();
    await page.locator('select[name="page.filters.gender"]').selectOption('female');
    await page.locator('input[name="page.filters.species"]').fill('Alien');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.locator('[data-testid="catalog-filter-submit"]').click(),
    ]);
    const url = new URL(page.url());
    if (url.searchParams.get('page.filters.gender') !== 'female' || url.searchParams.get('page.filters.species') !== 'Alien')
      throw new Error(`без JS: фильтры не попали в адрес: ${url.search}`);
    if (url.searchParams.get('page.src') !== 'rm-graphql') throw new Error('без JS: источник не сохранился');
    const texts = await page.locator('[data-testid^="rm-"]').allInnerTexts();
    if (!texts.length || !texts.every((t) => /женский/.test(t))) throw new Error(`без JS: выдача не отфильтрована: ${texts}`);
    console.log(`  ok  без JS форма фильтров GraphQL-версии отправляет GET и сужает выдачу (${texts.length} строк)`);
  } finally {
    await context.close();
  }
}

async function checkSwitch(browser) {
  console.log('— Переключение REST ↔ GraphQL в панели —');
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const rows = page.locator('[data-paginator-host="demo-url"] [data-testid^="rm-"]');
  const rowIds = () => rows.evaluateAll((els) => els.map((el) => el.dataset.testid));
  try {
    await page.goto(`${U}?page.src=rm-rest&${OPTS}&${FILTERED}`, { waitUntil: 'networkidle' });
    await waitFor(async () => (await rows.count()) === 5, { what: '5 строк REST' });
    const restIds = await rowIds();

    const cur = page.locator('[data-testid="demo-panel"] input[name="page.cur"]');
    if (!(await cur.isDisabled())) throw new Error('опция курсора должна быть недоступна у Rick and Morty');
    const nav = (await page.locator('[data-paginator-host="demo-url"] [data-testid="page-nav"]').innerText()).replace(/\s+/g, ' ');
    if (!/\d/.test(nav)) throw new Error(`номера страниц должны быть (API отдаёт count): «${nav}»`);
    console.log(`  ok  курсор недоступен, номера страниц есть: «${nav.trim().slice(0, 60)}»`);

    await page.locator('[data-testid="demo-panel"] select[name="page.src"]').selectOption('rm-graphql');
    await waitFor(async () => page.url().includes('page.src=rm-graphql'), { what: 'src в адресе' });
    // Смена источника снимает запрос и фильтры, как страницу (решение владельца, ход 112).
    const url = new URL(page.url());
    if (url.searchParams.has('page.filters.status') || url.searchParams.has('page.q'))
      throw new Error(`после переключения фильтр/запрос остались в адресе: ${url.search}`);
    const status = await page.locator('[data-testid="filters-panel"] select[name="page.filters.status"]').inputValue();
    if (status !== '') throw new Error(`форма фильтров после переключения: status=${status}`);
    const typed = await page.locator('[data-testid="search-input"]').inputValue();
    if (typed !== '') throw new Error(`поле запроса после переключения: «${typed}»`);
    // Тот же набор вручную в GraphQL — та же выдача, что в REST.
    await page.goto(`${U}?page.src=rm-graphql&${OPTS}&${FILTERED}`, { waitUntil: 'networkidle' });
    await waitFor(async () => same(await rowIds(), restIds), { what: 'та же выдача в GraphQL' });
    console.log(`  ok  REST → GraphQL: запрос и фильтр сняты (адрес, форма, поле); тот же набор в GraphQL — та же выдача (${restIds.join(',')})`);

    await page.locator('[data-testid="demo-panel"] select[name="page.src"]').selectOption('db');
    await waitFor(async () => page.url().includes('page.src=db'), { what: 'src=db в адресе' });
    await waitFor(async () => (await page.locator('[data-testid="filters-panel"]').count()) === 0, {
      what: 'панель фильтров исчезла у БД',
    });
    console.log('  ok  у БД панели фильтров Rick and Morty нет');
  } finally {
    await context.close();
  }
}

async function run() {
  await ensureServer();
  await checkApi();
  const browser = await chromium.launch({ headless: true });
  try {
    await checkSsr(browser);
    await checkSwitch(browser);
    console.log('\n✅ Rick and Morty: REST и GraphQL, окно страницы, SSR/без JS, смена версии снимает запрос и фильтры');
  } finally {
    await browser.close();
    killServer();
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAIL rickmorty browser test:', err);
    killServer();
    process.exit(1);
  });
