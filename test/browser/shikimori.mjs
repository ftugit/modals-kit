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

/**
 * Ожидаемые пути контролов из схемы источника — ровно то, что обязана нарисовать
 * панель: мультивыбор даёт по контролу на каждый объявленный режим (`and`/`not`),
 * числовое поле — на каждую границу (`min`/`max`), одиночное — один. Числа
 * контролов в проверках не хардкодятся: состав полей меняется вместе со схемой
 * (так добавился `filters.studios.not`, и это не должно ломать набор).
 */
function expectedFilterPaths(schema) {
  return schema.fields.flatMap((field) =>
    field.type === 'multiselect'
      ? (field.modes ?? ['or']).map((mode) => `filters.${field.key}.${mode}`)
      : field.type === 'number'
        ? (field.bounds ?? ['min', 'max']).map((bound) => `filters.${field.key}.${bound}`)
        : [`filters.${field.key}`],
  );
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

/** Раскрыть панель фильтров (нативный <details>): открыт — второй раз не кликаем. */
async function openFilters(page) {
  const details = page.locator('[data-testid="filters-details"]');
  if (!(await details.evaluate((el) => el.open))) await page.locator('[data-testid="filters-toggle"]').click();
}

/** Select a JS-enhanced filter through its visible list, not a missing native option. */
async function chooseFilterOption(page, select, value, label) {
  const name = await select.getAttribute('name');
  await select.scrollIntoViewIfNeeded();
  const listbox = page.locator('[data-select-listbox]').last();
  if (!(await listbox.isVisible().catch(() => false))) {
    await select.click({ force: true });
    await listbox.waitFor({ state: 'visible' });
  }
  const options = listbox.locator('[role="option"]');
  let match = -1;
  for (let i = 0; i < (await options.count()); i += 1) {
    const visibleLabel = (await options.nth(i).innerText()).trim().split('\n')[0].trim();
    if (visibleLabel === label) {
      match = i;
      break;
    }
  }
  if (match < 0) throw new Error(`у ${name} нет видимой опции «${label}»`);
  await options.nth(match).click();
  await page.waitForFunction(([fieldName, expected]) => {
    const field = [...document.querySelectorAll('select')].find((item) => item.name === fieldName);
    return field?.multiple
      ? [...field.selectedOptions].some((option) => option.value === expected)
      : field?.value === expected;
  }, [name, value]);
}

/**
 * Панель фильтров (этап 4): контролы приходят ИЗ СХЕМЫ, а применение идёт тем же
 * каналом, что и остальные настройки (хранилище пагинатора). Проверяется то, что
 * видно только в браузере: панель есть у источника с фильтрами и её нет у
 * источника без них, выбор из формы сужает выдачу и попадает в адрес, чип снимает
 * РОВНО одно значение, а связка гасит поле с причиной.
 */
async function checkFiltersUi(browser) {
  console.log('— Панель фильтров: схема в контролах, снятие чипом, связки —');
  const schema = (await api('/api/shikimori/filters')).body;
  const expected = expectedFilterPaths(schema);

  const context = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const panel = page.locator('[data-testid="filters-panel"]');
  const label = (field, value) =>
    schema.fields.find((item) => item.key === field)?.options?.find((item) => item.value === value)?.label ?? value;

  try {
    // Источник без фильтров: возможности нет — нет и панели (не «панель вхолостую»).
    await page.goto(`${U}?page.mode=single`, { waitUntil: 'networkidle' });
    await waitFor(async () => (await page.locator('[data-testid="filters-panel"]').count()) === 0, {
      what: 'панель отсутствует у источника без фильтров',
    });
    console.log('  ok  у товаров (нет возможности `filters`) панели нет');

    await page.goto(`${U}?page.src=animes&page.size=5&${OPTS}`, { waitUntil: 'networkidle' });
    await waitFor(async () => await panel.isVisible(), { what: 'панель фильтров' });
    const paths = await panel
      .locator('[data-testid="catalog-filter-field"]')
      .evaluateAll((els) => els.map((el) => el.dataset.filterPath));
    if (paths.join(',') !== expected.join(','))
      throw new Error(`контролы не совпали со схемой:\n ${paths}\n ${expected}`);
    if ((await panel.locator('[data-testid="filters-built-at"]').count()) !== 1)
      throw new Error('панель не показывает метку сборки схемы');
    console.log(`  ok  контролов ${paths.length} — ровно объявленные схемой пути (режимы и границы включены)`);

    // Второй пагинатор на странице (?gallery.*) — его ключи едут скрытыми полями.
    await page.goto(`${U}?page.src=animes&page.size=5&gallery.size=5&${OPTS}`, { waitUntil: 'networkidle' });
    await waitFor(async () => await panel.isVisible(), { what: 'панель после перезагрузки' });
    const hidden = await panel
      .locator('[data-testid="catalog-filter-form"] input[type="hidden"]')
      .evaluateAll((els) => els.map((el) => `${el.name}=${el.value}`));
    for (const key of ['page.src=animes', 'page.size=5', 'gallery.size=5']) {
      if (!hidden.includes(key)) throw new Error(`чужой ключ адреса не сохраняется формой: ${key} (${hidden})`);
    }
    console.log(`  ok  скрытые поля формы несут чужие ключи адреса: ${hidden.join(', ')}`);

    // Подпись и контрол связаны по-настоящему: `for` каждой подписи указывает
    // на существующий узел, и клик по подписи фокусирует ЭТОТ контрол.
    // Регрессия, которую ловим: у примитива Select раньше не было `id`, и
    // `<label for>` молча ничего не фокусировал.
    await openFilters(page) // подписи живут внутри <details>: сначала раскрыть
    const labelCheck = await panel.locator('[data-testid="catalog-filter-field"]').evaluateAll((fields) =>
      fields.map((field) => {
        const label = field.querySelector('label');
        const id = label?.getAttribute('for');
        const target = id ? field.querySelector(`#${CSS.escape(id)}`) : null;
        const control = field.querySelector('input, select');
        // `aria-describedby` (пояснение к полю: причина гашения, обрезка
        // списка) обязан указывать на существующий узел — ссылка в пустоту
        // неотличима от отсутствия связи, но заметна только скринридеру.
        const describedby = (control?.getAttribute('aria-describedby') ?? '')
          .split(' ')
          .filter(Boolean)
          .map((ref) => ({ ref, found: !!field.querySelector(`#${CSS.escape(ref)}`) }));
        return { id, linked: !!target, tag: target?.tagName ?? null, describedby };
      }),
    );
    const broken = labelCheck.filter(
      (item) => !item.id || !item.linked || item.describedby.some((d) => !d.found),
    );
    if (broken.length) throw new Error(`связи поля разъехались: ${JSON.stringify(broken)}`);
    const described = labelCheck.flatMap((item) => item.describedby.map((d) => d.ref));
    const labelTarget = `page.filters.${schema.fields.find((field) => field.type === 'select').key}`;
    await panel.locator(`label[for="${labelTarget}"]`).click();
    const focused = await page.evaluate(() => document.activeElement?.id ?? null);
    if (focused !== labelTarget)
      throw new Error(`клик по подписи не фокусирует контрол (активен: ${focused})`);
    console.log(`  ok  подпись связана с контролом: ${labelCheck.length} подписей, клик по «${labelTarget}» фокусирует его`);
    console.log(`      aria-describedby указывает на существующие пояснения: ${described.join(', ') || '—'}`);

    // Поиск в списке фильтра ищет по тому, что ВИДНО. Значением варианта служит
    // id справочника источника («133»), поэтому поиск ТОЛЬКО по значению не
    // находил подпись — регрессия владельца «поиск в select не работает».
    await openFilters(page);
    const genres = panel.locator('select[data-select-native][name="page.filters.genres.and"]');
    await genres.scrollIntoViewIfNeeded();
    await genres.click({ force: true });
    await waitFor(async () => (await page.locator('[data-select-listbox] [role="option"]').count()) > 1, {
      what: 'список жанров раскрыт',
    });
    const searchBox = page.locator('[data-select-content] input[role="combobox"]').first();
    await searchBox.click();
    const found = async (query) => {
      await searchBox.fill(query);
      await page.waitForTimeout(150);
      return page.locator('[data-select-listbox] [role="option"]').allInnerTexts();
    };
    const byLabel = await found('романтика');
    if (byLabel.length > 5 || !byLabel.some((text) => text.includes('Романтика')))
      throw new Error(`поиск по подписи не сработал: ${JSON.stringify(byLabel)}`);
    const withoutYo = await found('сенен');
    if (!withoutYo.some((text) => text.includes('Сёнен')))
      throw new Error(`поиск не нашёл «Сёнен» без «ё»: ${JSON.stringify(withoutYo)}`);
    const byValue = await found('22'); // «Романтика» — id 22 в справочнике v2
    if (!byValue.some((text) => text.includes('Романтика')))
      throw new Error(`поиск по значению перестал работать: ${JSON.stringify(byValue)}`);
    await page.keyboard.press('Escape');
    await waitFor(async () => (await page.locator('[data-select-content]').count()) === 0, {
      what: 'список закрыт',
    });
    console.log('  ok  поиск в списке фильтра: по подписи («романтика» → «Романтика»), без «ё» и по значению');

    await openFilters(page);
    await chooseFilterOption(
      page,
      panel.locator('select[data-select-native][name="page.filters.kind"]'),
      'tv',
      label('kind', 'tv'),
    );
    await page.locator('[data-testid="catalog-filter-submit"]').click();
    await waitFor(async () => page.url().includes('page.filters.kind=tv'), { what: 'фильтр в адресе' });
    await waitFor(async () => {
      const ids = await rowsOf(page).evaluateAll((els) => els.map((el) => el.dataset.testid.replace('anime-', '')));
      const api1 = await api('/api/shikimori/animes?limit=5&filters.kind=tv');
      return ids.join(',') === api1.body.items.map((it) => String(it.id)).join(',');
    }, { what: 'выдача сужена фильтром «Тип: ТВ»' });
    const appliedNow = [...new URL(page.url()).searchParams.keys()].filter((key) =>
      key.startsWith('page.filters.'),
    );
    if (appliedNow.join(',') !== 'page.filters.kind')
      throw new Error(`в адрес уехали ключи, которых пользователь не выбирал: ${appliedNow}`);
    const chip = page.locator('[data-testid="active-filter"]');
    if ((await chip.count()) !== 1) throw new Error(`после одного фильтра ждали один чип, их ${await chip.count()}`);
    if ((await chip.getAttribute('data-filter-path')) !== 'filters.kind')
      throw new Error('чип ссылается не на то поле');
    // Подписи — ИЗ СХЕМЫ (их собирает серверная зона): у типа это «TV»,
    // у жанров — русские имена. Своих подписей интерфейс не выдумывает.
    const chipText = (await chip.innerText()).replace(/\s+/g, ' ').trim();
    if (!chipText.includes('Тип') || !chipText.includes(label('kind', 'tv')))
      throw new Error(`подпись чипа не из схемы: «${chipText}» вместо «Тип: ${label('kind', 'tv')}»`);
    if ((await page.locator('[data-testid="filters-count"]').innerText()) !== '1')
      throw new Error('счётчик панели не совпал с числом фильтров');
    console.log(`  ok  выбор из формы применён (адрес + выдача как у роута), чип «${chipText}»`);

    // Фильтр сбрасывает указатель: стр. 2 → применение → стр. 1 в адресе нет.
    await page.locator('[data-paginator-host="demo-url"] a[aria-label="Вперёд"], [data-paginator-host="demo-url"] button[aria-label="Вперёд"]').first().evaluate((el) => el.click());
    await waitFor(async () => page.url().includes('page=2'), { what: 'переход на стр. 2' });
    await openFilters(page);
    await chooseFilterOption(
      page,
      panel.locator('select[data-select-native][name="page.filters.status"]'),
      'released',
      label('status', 'released'),
    );
    await page.locator('[data-testid="catalog-filter-submit"]').click();
    await waitFor(async () => page.url().includes('page.filters.status=released'), { what: 'второй фильтр в адресе' });
    if (/[?&]page=2(&|$)/.test(page.url()))
      throw new Error(`смена фильтров обязана начинать с первой страницы: ${page.url()}`);
    console.log('  ok  новый набор фильтров сбрасывает указатель страницы (в адресе нет page=2)');

    // Клик по чипу снимает РОВНО одно значение: второй фильтр остаётся.
    const kindChip = page.locator('[data-testid="active-filter"][data-filter-path="filters.kind"]');
    await kindChip.evaluate((el) => el.click());
    await waitFor(async () => !page.url().includes('page.filters.kind'), { what: 'фильтр снят чипом' });
    if (!page.url().includes('page.filters.status=released'))
      throw new Error(`снятие чипа унесло соседний фильтр: ${page.url()}`);
    if ((await page.locator('[data-testid="active-filter"]').count()) !== 1)
      throw new Error('после снятия чипа должен остаться один активный фильтр');
    console.log('  ok  чип снял только своё значение (соседний фильтр и адрес целы)');

    // Числовые контролы читаются как FormData.getAll() → string[]. Score и год
    // обязаны пережить этот путь до числового extra, URL и параметров API.
    console.log('— Оценка и год: JS FormData → extra → URL → API —');
    await page.goto(`${U}?page.src=animes&page.size=5&${OPTS}`, { waitUntil: 'networkidle' });
    await openFilters(page);
    await panel.locator('input[name="page.filters.score.min"]').fill('8');
    await panel.locator('input[name="page.filters.year.min"]').fill('1990');
    await panel.locator('input[name="page.filters.year.max"]').fill('1992');
    await page.locator('[data-testid="catalog-filter-submit"]').click();
    await waitFor(async () => {
      const params = new URL(page.url()).searchParams;
      return params.get('page.filters.score.min') === '8' &&
        params.get('page.filters.year.min') === '1990' && params.get('page.filters.year.max') === '1992';
    }, { what: 'JS сохраняет score и обе границы года в URL' });
    const numeric = await api('/api/shikimori/animes?limit=5&filters.score.min=8&filters.year.min=1990&filters.year.max=1992');
    if (numeric.status !== 200 || numeric.body.dropped?.length)
      throw new Error(`score/year отклонены сервером: ${JSON.stringify(numeric.body.dropped)}`);
    if (!numeric.body.items.length || numeric.body.items.some((item) =>
      item.score < 8 || item.year < 1990 || item.year > 1992))
      throw new Error(`score/year не сузили фактическую выдачу: ${JSON.stringify(numeric.body.items)}`);
    const numericIds = numeric.body.items.map((item) => String(item.id));
    await waitFor(async () => {
      const visible = await rowsOf(page).evaluateAll((els) => els.map((el) => el.dataset.testid.replace('anime-', '')));
      return visible.join(',') === numericIds.join(',');
    }, { what: 'JS выдача совпадает с API score/year' });
    console.log(`  ok  JS score≥8 + year 1990–1992 сохранились и сузили выдачу до ${numericIds.length} записей`);

    // Связка: у анонсов нет оценки — поле гаснет, причина видна.
    await openFilters(page);
    await chooseFilterOption(
      page,
      panel.locator('select[data-select-native][name="page.filters.status"]'),
      'anons',
      label('status', 'anons'),
    );
    await page.locator('[data-testid="catalog-filter-submit"]').click();
    await waitFor(async () => page.url().includes('page.filters.status=anons'), { what: 'фильтр «анонс»' });
    const reason = await panel.locator('[data-testid="catalog-filter-reason"]').innerText();
    if (!/оценк/i.test(reason)) throw new Error(`причина гашения не из связки схемы: «${reason}»`);
    if (!(await panel.locator('input[name="page.filters.score.min"]').isDisabled()))
      throw new Error('поле оценки под связкой должно быть выключено');
    console.log(`  ok  связка схемы: «${reason.trim()}» — поле выключено, причина показана`);

    // Политика «заблокированное значение снимается при применении»: адрес
    // (со старым значением в ссылке) её не теряет, а «Применить» — не пишет.
    await page.goto(
      `${U}?page.src=animes&page.size=5&page.filters.status=anons&page.filters.score.min=5&${OPTS}`,
      { waitUntil: 'networkidle' },
    );
    const beforeApply = [...new URL(page.url()).searchParams.keys()].filter((key) =>
      key.startsWith('page.filters.'),
    );
    if (!beforeApply.includes('page.filters.score.min'))
      throw new Error(`адрес со заблокированным значением потерял ключ: ${beforeApply}`);
    const blockedScore = panel.locator('input[name="page.filters.score.min"]');
    await waitFor(async () => await blockedScore.isDisabled(), { what: 'JS отключил поле оценки под связкой' });
    const invalidNotice = page.locator('[data-testid="filters-validation"]');
    if (!(await invalidNotice.isVisible()) || !/анонс.*оценк/i.test(await invalidNotice.innerText()))
      throw new Error(`JS должен показать ту же причину связки до применения: ${await invalidNotice.innerText()}`);
    await openFilters(page);
    await page.locator('[data-testid="catalog-filter-submit"]').click();
    await waitFor(async () => !page.url().includes('page.filters.score.min'), {
      what: 'связка сняла заблокированное значение при применении',
    });
    if (!page.url().includes('page.filters.status=anons'))
      throw new Error(`применение фильтров потеряло соседний фильтр: ${page.url()}`);
    if ((await page.locator('[data-testid="active-filter"]').count()) !== 1)
      throw new Error('после применения под связкой должен остаться один активный фильтр');
    if (!(await invalidNotice.isVisible()) || !/анонс.*оценк/i.test(await invalidNotice.innerText()))
      throw new Error('причина отключения score должна оставаться видимой, пока выбран status=anons');
    console.log('  ok  JS disabled поле; при применении score удалён, причина связи осталась видна, чипы/адрес согласованы');

    // Связка с поиском: `status=latest` запрещает `q` — панель говорит об этом.
    await page.goto(`${U}?page.src=animes&page.size=5&page.filters.status=latest&${OPTS}`, {
      waitUntil: 'networkidle',
    });
    await waitFor(async () => await panel.locator('[data-testid="filters-search-blocked"]').isVisible(), {
      what: 'причина запрета поиска',
    });
    const blocked = await panel.locator('[data-testid="filters-search-blocked"]').innerText();
    if (!/поиск/i.test(blocked)) throw new Error(`причина запрета поиска не внятная: «${blocked}»`);
    console.log(`  ok  связка «поиск под фильтром» видна в панели: ${blocked.replace(/\s+/g, ' ').trim()}`);

    // Multiselect остаётся раскрытым после выбора. Кнопка «Применить» —
    // реальная цель pointerdown, а не click-through из-за закрывающегося щита:
    // один пользовательский клик обязан и закрыть выпадашку, и отправить форму.
    await page.goto(`${U}?page.src=animes&page.size=5&${OPTS}`, { waitUntil: 'networkidle' });
    await openFilters(page);
    await chooseFilterOption(
      page,
      panel.locator('select[data-select-native][name="page.filters.genres.and"]'),
      '22',
      label('genres', '22'),
    );
    if ((await page.locator('[data-select-listbox]').count()) !== 1)
      throw new Error('multiselect должен оставаться открытым после выбора жанра');
    await page.locator('[data-testid="catalog-filter-submit"]').click();
    await waitFor(async () => page.url().includes('page.filters.genres.and=22'), {
      what: 'клик по «Применить» отправил выбранный жанр при открытом списке',
    });
    if ((await page.locator('[data-select-listbox]').count()) !== 0)
      throw new Error('список не закрылся после применения жанра');
    console.log('  ok  один клик по «Применить» закрыл открытый multiselect и записал genres.and=22');

    // Поле запроса зеркалит ХРАНИЛИЩЕ, а не адрес: в url-режиме адрес и есть
    // хранилище, в localStorage — состояние оттуда, и адрес остаётся чужим.
    await page.goto(`${U}?page.src=animes&page.size=5&${OPTS}`, { waitUntil: 'networkidle' });
    const searchInput = page.locator('[data-testid="search-input"]');
    await searchInput.fill('наруто');
    await waitFor(() => page.url().includes('page.q=%D0%BD%D0%B0%D1%80%D1%83%D1%82%D0%BE') || page.url().includes('page.q=наруто'),
      { what: 'url-режим: запрос записан в адрес' });
    await page.locator('[data-testid="demo-panel"] select[name="store"]').selectOption('local');
    await sleep(1200);
    const afterSwitch = await searchInput.inputValue();
    if (afterSwitch !== '')
      throw new Error(`после перехода на localStorage поле обязано очиститься (в хранилище запроса нет), а не показать адрес: «${afterSwitch}»`);
    await searchInput.fill('кот');
    await sleep(900);
    const rawLocal = JSON.parse(await page.evaluate(() => localStorage.getItem('pag:demo-local-ls')));
    if (rawLocal.extra?.q !== 'кот')
      throw new Error(`запрос не лёг в localStorage: ${JSON.stringify(rawLocal.extra)}`);
    if (decodeURIComponent(page.url()).includes('page.q=кот'))
      throw new Error('localStorage-режим не должен писать запрос в адрес');
    // Перезагрузка: url-хранение → поле из адреса (адрес чист — пусто, не из LS).
    await page.goto(`${U}?page.src=animes&page.size=5&${OPTS}`, { waitUntil: 'networkidle' });
    await sleep(700);
    if (await searchInput.inputValue() !== '')
      throw new Error('url-режим после reload не должен подсматривать в localStorage');
    await page.locator('[data-testid="demo-panel"] select[name="store"]').selectOption('local');
    await sleep(1200);
    if (await searchInput.inputValue() !== 'кот')
      throw new Error(`после reload поле не достало запрос из localStorage: «${await searchInput.inputValue()}»`);
    if (decodeURIComponent(page.url()).includes('page.q'))
      throw new Error('адрес после восстановления из localStorage испачкан запросом');
    console.log('  ok  поле запроса живёт хранилищем: url — адрес, local — стор, не путаются');

    await context.close();
  } finally {
    if (!context.closed) await context.close().catch(() => {});
  }
}

/**
 * Тот же путь БЕЗ JavaScript: панель приходит в разметке SSR (схему собрал
 * сервер), раскрытие — нативный <details>, отправка — обычный GET формы.
 * Это и есть проверка «минимум сложности в UI»: без JS всё работает потому, что
 * форма настоящая, а не потому, что «для no-JS есть отдельная ветка».
 */
async function checkFiltersNoJs(browser) {
  console.log('— Фильтры без JavaScript: SSR-разметка и нативный GET —');
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 1200 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  try {
    await page.goto(`${U}?page.src=animes&page.size=5`, { waitUntil: 'domcontentloaded' });
    const fields = page.locator('[data-testid="filters-panel"] [data-testid="catalog-filter-field"]');
    const ssrPaths = await fields.evaluateAll((els) => els.map((el) => el.dataset.filterPath));
    const schema = (await api('/api/shikimori/filters')).body;
    const expectedPaths = expectedFilterPaths(schema);
    if (ssrPaths.join(',') !== expectedPaths.join(','))
      throw new Error(`без JS контролы не совпали со схемой:\n ${ssrPaths}\n ${expectedPaths}`);
    // Значения приходят из адреса: применим фильтр и вернёмся на адрес со фильтром.
    await openFilters(page);
    await page.locator('select[data-select-native][name="page.filters.kind"]').selectOption('movie');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.locator('[data-testid="catalog-filter-submit"]').click(),
    ]);
    const url = new URL(page.url());
    if (url.searchParams.get('page.filters.kind') !== 'movie')
      throw new Error(`нативный GET не донёс фильтр: ${page.url()}`);
    // Форма отправляет ВСЕ свои контролы, поэтому в адресе есть пустые ключи.
    // Так и должно быть: без JavaScript править адрес нечем, а переадресация
    // ради «списка пустых полей» отклонена владельцем (2026-10-08: «если
    // очистка url не будет требовать редиректа, то очищай»). Пустое значение
    // для слоя тождественно отсутствию ключа, поэтому страница от них не
    // зависит; с JavaScript адрес чистит клиент — заменой записи истории, без
    // перехода (см. `test/browser/paginate.mjs`). Здесь же важно другое:
    // ЗНАЧАЩИЙ фильтр ровно один, и это выбранный.
    const filled = [...url.searchParams.entries()].filter(
      ([key, value]) => key.startsWith('page.filters.') && value !== '',
    );
    if (filled.length !== 1 || filled[0][0] !== 'page.filters.kind')
      throw new Error(`нативный GET принёс лишние значащие фильтры: ${JSON.stringify(filled)}`);
    const empties = [...url.searchParams.entries()].filter(
      ([key, value]) => value === '' && (key === 'page' || key.startsWith('page.')),
    );
    // Повторное «Применить» без изменений: адрес засоряется только теми же
    // пустыми ключами формы (их и присылает браузер), значащих фильтров по-прежнему один.
    await openFilters(page);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.locator('[data-testid="catalog-filter-submit"]').click(),
    ]);
    const again = new URL(page.url());
    const filledAgain = [...again.searchParams.entries()].filter(
      ([key, value]) => key.startsWith('page.filters.') && value !== '',
    );
    if (filledAgain.length !== 1 || filledAgain[0][0] !== 'page.filters.kind')
      throw new Error(`повторное «Применить» добавило значащие фильтры: ${JSON.stringify(filledAgain)}`);
    for (const [key, value] of [
      ['page.src', 'animes'],
      ['page.size', '5'],
    ]) {
      if (url.searchParams.get(key) !== value)
        throw new Error(`чужой ключ ${key} потерян при отправке формы: ${page.url()}`);
    }
    // Выдачу сузил СЕРВЕР: строки пришли в разметке и совпадают с роутом.
    const ids = await page
      .locator('[data-paginator-host="demo-url"] a[data-testid^="anime-"]')
      .evaluateAll((els) => els.map((el) => el.dataset.testid.replace('anime-', '')));
    const api1 = await api('/api/shikimori/animes?limit=5&filters.kind=movie');
    if (!ids.length || ids.join(',') !== api1.body.items.map((it) => String(it.id)).join(','))
      throw new Error(`без JS выдача не совпала с роутом: ${ids} vs ${api1.body.items.map((it) => it.id)}`);
    const chips = page.locator('[data-testid="active-filter"]');
    if ((await chips.count()) !== 1)
      throw new Error(`без JS после одного фильтра ждали один чип, их ${await chips.count()}`);
    const chip = await chips.innerText();
    console.log(
      `  ok  без JS: контролов ${ssrPaths.length}, GET донёс «Тип: Фильм», чужие ключи целы, ` +
        `выдача — ${ids.length} фильмов (пустых ключей формы взято ${empties.length} — без JS они норма)`,
    );
    console.log(`      чип из схемы: ${chip.replace(/\s+/g, ' ').trim()}`);

    // Снятие чипа — настоящая ссылка: без JS это обычный переход.
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.locator('[data-testid="active-filter"]').click(),
    ]);
    if (page.url().includes('page.filters.kind'))
      throw new Error(`ссылка чипа не сняла фильтр: ${page.url()}`);
    console.log('  ok  без JS чип снимается обычной ссылкой (адрес чист от этого фильтра)');

    // No-JS GET may carry a schema-known impossible relationship. Per the
    // link model (§7.9) the whole set is REJECTED: the URL keeps what the
    // user sent, the server applies nothing (not even the blocking side),
    // and the refusal is explained — under the field and outside the panel.
    console.log('— No-JS: отказ целого набора для несовместимых status + score —');
    await page.goto(`${U}?page.src=animes&page.size=5&${OPTS}`, { waitUntil: 'domcontentloaded' });
    await openFilters(page);
    await page.locator('select[data-select-native][name="page.filters.status"]').selectOption('anons');
    const scoreInput = page.locator('[data-testid="filters-panel"] input[name="page.filters.score.min"]');
    await scoreInput.fill('5');
    if (await scoreInput.isDisabled()) throw new Error('no-JS форма не должна молча отключать поле оценки');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.locator('[data-testid="catalog-filter-submit"]').click(),
    ]);
    const impossibleUrl = new URL(page.url());
    if (impossibleUrl.searchParams.get('page.filters.status') !== 'anons' ||
        impossibleUrl.searchParams.get('page.filters.score.min') !== '5')
      throw new Error(`no-JS GET должен сохранить оба введённых значения: ${page.url()}`);
    const validation = page.locator('[data-testid="filters-validation"]');
    if (!(await validation.isVisible()) || !/анонс.*оценк/i.test(await validation.innerText()))
      throw new Error(`no-JS объяснение должно быть видно без раскрытия формы: ${await validation.innerText()}`);
    if (await page.locator('[data-testid="filters-details"]').evaluate((el) => el.open))
      throw new Error('no-JS проверка должна оставаться видимой при закрытой форме');
    if (await scoreInput.isDisabled()) throw new Error('без JavaScript выбранное поле не должно быть disabled');
    // Отказ показан ПОД ПОЛЕМ жертвой (строка связки замещается отказом,
    // когда значение под связкой есть) — тот же текст, что у валидатора.
    const fieldError = page
      .locator('[data-testid="catalog-filter-reason"]')
      .filter({ hasText: /невозможно использовать совместно с/i });
    if ((await fieldError.count()) === 0) {
      const all = await page.locator('[data-testid="catalog-filter-reason"]').allTextContents();
      throw new Error(`отказ под полем не найден: ${JSON.stringify(all)}`);
    }
    const suppressed = await api('/api/shikimori/animes?limit=5&filters.status=anons&filters.score.min=5');
    const plain = await api('/api/shikimori/animes?limit=5');
    if (!suppressed.body.dropped?.some((item) => item.key === 'filters.score'))
      throw new Error(`no-JS связка не вернула причину: ${JSON.stringify(suppressed.body.dropped)}`);
    if (!suppressed.body.dropped?.some((item) => item.key === 'filters.status' && /отклонён связкой/.test(item.reason)))
      throw new Error(`отказ не объяснил, почему не применён и status: ${JSON.stringify(suppressed.body.dropped)}`);
    if (suppressed.body.items.map((item) => item.id).join(',') !== plain.body.items.map((item) => item.id).join(','))
      throw new Error('несовместимый набор применился частично: выдача отличается от каталога без фильтров');
    console.log(
      '  ok  no-JS: URL цел, отказ назван под полем и в списке, набор отклонён целиком — ' +
        'выдача равна каталогу без фильтров',
    );

    // Без JS те же score/year поля отправляются нативным GET на серверный
    // источник; проверяем диапазон и фактическую выдачу, а не только URL.
    console.log('— Оценка и год: no-JS GET → source schema → Shikimori —');
    await page.goto(`${U}?page.src=animes&page.size=5&${OPTS}`, { waitUntil: 'domcontentloaded' });
    await openFilters(page);
    await page.locator('[data-testid="filters-panel"] input[name="page.filters.score.min"]').fill('8');
    await page.locator('[data-testid="filters-panel"] input[name="page.filters.year.min"]').fill('1990');
    await page.locator('[data-testid="filters-panel"] input[name="page.filters.year.max"]').fill('1992');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.locator('[data-testid="catalog-filter-submit"]').click(),
    ]);
    const scoreYearUrl = new URL(page.url());
    if (scoreYearUrl.searchParams.get('page.filters.score.min') !== '8' ||
        scoreYearUrl.searchParams.get('page.filters.year.min') !== '1990' ||
        scoreYearUrl.searchParams.get('page.filters.year.max') !== '1992')
      throw new Error(`no-JS GET потерял score/year: ${page.url()}`);
    const scoreYear = await api('/api/shikimori/animes?limit=5&filters.score.min=8&filters.year.min=1990&filters.year.max=1992');
    if (scoreYear.status !== 200 || scoreYear.body.dropped?.length || !scoreYear.body.items.length)
      throw new Error(`no-JS score/year не применились: ${JSON.stringify(scoreYear.body.dropped)}`);
    if (scoreYear.body.items.some((item) => item.score < 8 || item.year < 1990 || item.year > 1992))
      throw new Error(`no-JS score/year пропустили чужие записи: ${JSON.stringify(scoreYear.body.items)}`);
    const serverIds = await rowsOf(page).evaluateAll((els) => els.map((el) => el.dataset.testid.replace('anime-', '')));
    if (serverIds.join(',') !== scoreYear.body.items.map((item) => String(item.id)).join(','))
      throw new Error(`no-JS SSR отличается от score/year API: ${serverIds}`);
    console.log(`  ok  no-JS score≥8 + year 1990–1992 дошли до источника; SSR показывает ${serverIds.length} точных записей`);

    // Native multiple-select submits one GET parameter per selected option.
    // The URL adapter must fold those repeats into the source's canonical CSV list.
    console.log('— Multiselect без JS: оба жанра доходят до источника —');
    await page.goto(`${U}?page.src=animes&page.size=5&${OPTS}`, { waitUntil: 'domcontentloaded' });
    await openFilters(page);
    const genreSelect = page.locator('select[data-select-native][name="page.filters.genres.and"]');
    await genreSelect.selectOption(['22', '27']);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.locator('[data-testid="catalog-filter-submit"]').click(),
    ]);
    const directUrl = new URL(page.url());
    const directValues = directUrl.searchParams.getAll('page.filters.genres.and').sort();
    if (directValues.join(',') !== '22,27')
      throw new Error(`native GET не отправил оба жанра: ${JSON.stringify(directValues)}`);
    const directSelected = await page
      .locator('select[data-select-native][name="page.filters.genres.and"]')
      .evaluate((el) => [...el.selectedOptions].map((option) => option.value).sort());
    if (directSelected.join(',') !== '22,27')
      throw new Error(`после SSR один из жанров пропал: ${JSON.stringify(directSelected)}`);
    const directChips = page.locator('[data-testid="active-filter"][data-filter-path="filters.genres.and"]');
    if ((await directChips.count()) !== 2)
      throw new Error(`ожидали два genre-чипа после no-JS GET, получили ${await directChips.count()}`);
    const expectedMulti = await api('/api/shikimori/animes?limit=5&filters.genres.and=22,27');
    const directIds = await page
      .locator('[data-paginator-host="demo-url"] a[data-testid^="anime-"]')
      .evaluateAll((els) => els.map((el) => el.dataset.testid.replace('anime-', '')));
    if (!expectedMulti.body.items.length || directIds.join(',') !== expectedMulti.body.items.map((item) => String(item.id)).join(','))
      throw new Error(`no-JS выдача не применила оба жанра: ${directIds} vs ${expectedMulti.body.items.map((item) => item.id)}`);
    console.log('  ok  прямой no-JS GET: два повторяющихся параметра стали CSV, два чипа и точная выдача API');

    // A JS-applied CSV URL must round-trip through the no-JS native form too.
    const jsContext = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
    try {
      const jsPage = await jsContext.newPage();
      await jsPage.goto(`${U}?page.src=animes&page.size=5&${OPTS}`, { waitUntil: 'networkidle' });
      await openFilters(jsPage);
      const jsGenres = jsPage.locator('select[data-select-native][name="page.filters.genres.and"]');
      const genreOptions = schema.fields.find((field) => field.key === 'genres').options;
      const genreLabel = (value) => genreOptions.find((option) => option.value === value)?.label ?? value;
      await chooseFilterOption(jsPage, jsGenres, '22', genreLabel('22'));
      await chooseFilterOption(jsPage, jsGenres, '27', genreLabel('27'));
      const selectedByJs = await jsGenres.evaluate((el) => [...el.selectedOptions].map((option) => option.value).sort());
      if (selectedByJs.join(',') !== '22,27')
        throw new Error(`JS multiselect не удержал два жанра: ${JSON.stringify(selectedByJs)}`);
      await jsPage.locator('[data-testid="catalog-filter-submit"]').click();
      await waitFor(
        async () => new URL(jsPage.url()).searchParams.get('page.filters.genres.and') !== null,
        { what: 'JS multiselect in URL' },
      );
      const jsUrl = new URL(jsPage.url());
      const jsCsv = jsUrl.searchParams.getAll('page.filters.genres.and');
      if (jsCsv.length !== 1 || jsCsv[0].split(',').sort().join(',') !== '22,27')
        throw new Error(`JS путь должен записать один канонический CSV, получили ${JSON.stringify(jsCsv)}`);
      await jsPage.close();

      await page.goto(jsUrl.href, { waitUntil: 'domcontentloaded' });
      const restored = await page
        .locator('select[data-select-native][name="page.filters.genres.and"]')
        .evaluate((el) => [...el.selectedOptions].map((option) => option.value).sort());
      if (restored.join(',') !== '22,27')
        throw new Error(`no-JS навигация потеряла JS-настройку: ${JSON.stringify(restored)}`);
      await openFilters(page);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        page.locator('[data-testid="catalog-filter-submit"]').click(),
      ]);
      const roundTrip = new URL(page.url()).searchParams.getAll('page.filters.genres.and').sort();
      if (roundTrip.join(',') !== '22,27')
        throw new Error(`JS→no-JS→GET потерял выбранный жанр: ${JSON.stringify(roundTrip)}`);
      const roundTripChips = page.locator('[data-testid="active-filter"][data-filter-path="filters.genres.and"]');
      if ((await roundTripChips.count()) !== 2)
        throw new Error(`JS→no-JS после GET ожидали два жанра, чипов ${await roundTripChips.count()}`);
      const roundTripIds = await page
        .locator('[data-paginator-host="demo-url"] a[data-testid^="anime-"]')
        .evaluateAll((els) => els.map((el) => el.dataset.testid.replace('anime-', '')));
      if (roundTripIds.join(',') !== expectedMulti.body.items.map((item) => String(item.id)).join(','))
        throw new Error(`JS→no-JS выдача потеряла часть списка: ${roundTripIds}`);
      console.log('  ok  JS → no-JS GET round-trip: CSV восстановлен и оба жанра применены');
    } finally {
      await jsContext.close();
    }
    await context.close();
  } finally {
    if (!context.closed) await context.close().catch(() => {});
  }
}


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
    await checkFiltersUi(browser);
    await checkFiltersNoJs(browser);
    console.log(
      '\n✅ Живой источник Shikimori: SSR, стрелочная навигация, родной поиск, lib/search и панель фильтров (JS и без JS)',
    );
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
