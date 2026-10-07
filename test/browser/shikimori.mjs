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

/** Раскрыть панель фильтров (нативный <details>): открыт — второй раз не кликаем. */
async function openFilters(page) {
  const details = page.locator('[data-testid="filters-details"]');
  if (!(await details.evaluate((el) => el.open))) await page.locator('[data-testid="filters-toggle"]').click();
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
  const expected = schema.fields.flatMap((field) =>
    field.type === 'multiselect'
      ? (field.modes ?? ['or']).map((mode) => `filters.${field.key}.${mode}`)
      : field.type === 'number'
        ? (field.bounds ?? ['min', 'max']).map((bound) => `filters.${field.key}.${bound}`)
        : [`filters.${field.key}`],
  );

  const context = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const panel = page.locator('[data-testid="filters-panel"]');

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

    await openFilters(page);
    await panel
      .locator('select[data-select-native][name="page.filters.kind"]')
      .selectOption('tv', { force: true });
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
    const label = (field, value) =>
      schema.fields.find((item) => item.key === field)?.options?.find((item) => item.value === value)?.label ?? value;
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
    await panel
      .locator('select[data-select-native][name="page.filters.status"]')
      .selectOption('released', { force: true });
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

    // Связка: у анонсов нет оценки — поле гаснет, причина видна.
    await openFilters(page);
    await panel
      .locator('select[data-select-native][name="page.filters.status"]')
      .selectOption('anons', { force: true });
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
    await openFilters(page);
    await page.locator('[data-testid="catalog-filter-submit"]').click();
    await waitFor(async () => !page.url().includes('page.filters.score.min'), {
      what: 'связка сняла заблокированное значение при применении',
    });
    if (!page.url().includes('page.filters.status=anons'))
      throw new Error(`применение фильтров потеряло соседний фильтр: ${page.url()}`);
    if ((await page.locator('[data-testid="active-filter"]').count()) !== 1)
      throw new Error('после применения под связкой должен остаться один активный фильтр');
    console.log('  ok  значение под связкой уходит при «Применить» (соседний фильтр цел, чипов 1)');

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
    // Переадресация на канонический адрес — ОТДЕЛЬНАЯ навигация: дожидаемся
    // именно чистой строки запроса. Без page.evaluate (в контексте без JS он
    // недоступен) — опросом адреса со стороны драйвера.
    const waitCanonical = async () => {
      for (let i = 0; i < 100; i += 1) {
        const params = new URL(page.url()).searchParams;
        const dirty = [...params.entries()].some(
          ([key, value]) => value === '' && (key === 'page' || key.startsWith('page.')),
        );
        if (!dirty) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error(`адрес не пришёл к каноническому виду: ${page.url()}`);
    };
    const fields = page.locator('[data-testid="filters-panel"] [data-testid="catalog-filter-field"]');
    const count = await fields.count();
    if (count !== 10) throw new Error(`без JS в разметке ${count} контролов вместо 10`);
    // Значения приходят из адреса: применим фильтр и вернёмся на адрес со фильтром.
    await openFilters(page);
    await page.locator('select[data-select-native][name="page.filters.kind"]').selectOption('movie');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.locator('[data-testid="catalog-filter-submit"]').click(),
    ]);
    await waitCanonical();
    const url = new URL(page.url());
    if (url.searchParams.get('page.filters.kind') !== 'movie')
      throw new Error(`нативный GET не донёс фильтр: ${page.url()}`);
    // Форма отправляет ВСЕ свои контролы (включая незаполненные), поэтому
    // адрес приводится к каноническому виду слоем адреса: пустые значения
    // объявленных ключей уходят (`canonicalPaginatorSearch`), и в адресе остался
    // ровно один выбранный фильтр, а не список полей с пустыми значениями.
    const filled = [...url.searchParams.entries()].filter(
      ([key, value]) => key.startsWith('page.filters.') && value !== '',
    );
    if (filled.length !== 1 || filled[0][0] !== 'page.filters.kind')
      throw new Error(`нативный GET принёс лишние фильтры: ${JSON.stringify(filled)}`);
    const empties = [...url.searchParams.entries()].filter(
      ([key, value]) => value === '' && (key === 'page' || key.startsWith('page.')),
    );
    if (empties.length)
      throw new Error(`в адресе остались пустые ключи пагинатора: ${JSON.stringify(empties)}`);
    // И повторное «Применить» без изменений адрес не засоряет: адрес уже
    // канонический, а форма снова шлёт все поля — их отсекает тот же слой.
    await openFilters(page);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.locator('[data-testid="catalog-filter-submit"]').click(),
    ]);
    await waitCanonical();
    const again = new URL(page.url());
    const emptiesAgain = [...again.searchParams.entries()].filter(
      ([key, value]) => value === '' && (key === 'page' || key.startsWith('page.')),
    );
    if (emptiesAgain.length)
      throw new Error(`повторное «Применить» засорило адрес: ${JSON.stringify(emptiesAgain)}`);
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
    console.log(`  ok  без JS: контролов 10, GET донёс «Тип: Фильм», чужие ключи целы, выдача — ${ids.length} фильмов`);
    console.log(`      чип из схемы: ${chip.replace(/\s+/g, ' ').trim()}`);

    // Снятие чипа — настоящая ссылка: без JS это обычный переход.
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.locator('[data-testid="active-filter"]').click(),
    ]);
    if (page.url().includes('page.filters.kind'))
      throw new Error(`ссылка чипа не сняла фильтр: ${page.url()}`);
    console.log('  ok  без JS чип снимается обычной ссылкой (адрес чист от этого фильтра)');
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
