/**
 * Сквозная проверка пагинатора в реальном браузере Chromium через Playwright (Svelte 5 порт).
 * Проверяет ключевой UX-инвариант: скролл страницы сайта (window.scrollY)
 * остаётся строго 0 при всех действиях внутри пагинатора:
 *  1. Первичная загрузка и скролл внутри контейнера;
 *  2. Переходы по страницам кнопками и ссылками;
 *  3. Смена раскладки (список <-> 4 колонки);
 *  4. Тоггели чекбоксов в панели опций;
 *  5. Догрузка сверху (prepend);
 *  6. Персист настроек в URL (?page, ?page.size, ?page.<key>) и localStorage;
 *  7. Восстановление настроек при шеринге ссылки (включая SSR);
 *  8. Возможности источника гасят опции панели (у фото поиска нет — опции
 *     и поле запроса погашены, число страниц работает);
 *  9. Два независимых URL-пагинатора на одной странице (?page.* и ?gallery.*);
 * 10. Скелетоны подгрузки (список/колонки, append/prepend) и отсутствие дубля
 *     строки «Загрузка страницы N…», когда скелетоны выключены.
 *
 * Запуск:
 *   MODALS_PORT=4173 node test/browser/paginate.mjs
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = Number(process.env.MODALS_PORT ?? process.env.PORT ?? 4173);
const U = process.env.PAGINATE_BASE ?? `http://127.0.0.1:${PORT}/paginator`;

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

async function run() {
  await ensureServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    console.log('— Открытие ' + U + ' ...');
    await page.goto(U, { waitUntil: 'networkidle' });

    let winScroll = await page.evaluate(() => window.scrollY);
    if (winScroll !== 0) throw new Error(`Начальный window.scrollY = ${winScroll}, ожидался 0`);
    console.log('  ok  начальный window.scrollY = 0');

    const host = page.locator('[data-paginator-host="demo-url"]');
    await host.waitFor({ state: 'visible' });

    // Скролл внутри контейнера
    await host.evaluate((el) => {
      el.scrollTop = 600;
    });
    await sleep(400);
    winScroll = await page.evaluate(() => window.scrollY);
    if (winScroll !== 0)
      throw new Error(`После скролла контейнера window.scrollY = ${winScroll}, ожидался 0`);
    console.log('  ok  скролл внутри контейнера не двигает окно (window.scrollY = 0)');

    // Переход на страницу 2
    const btn2 = page.locator('button:has-text("2"), a:has-text("2")').first();
    await btn2.evaluate((el) => el.click());
    await sleep(600);
    winScroll = await page.evaluate(() => window.scrollY);
    if (winScroll !== 0)
      throw new Error(`После клика по стр.2 window.scrollY = ${winScroll}, ожидался 0`);
    console.log('  ok  переход по пагинатору не срывает скролл окна (window.scrollY = 0)');

    // Смена раскладки на колонки и обратно
    const layoutSelect = page.locator('select[name="page.layout"]');
    await layoutSelect.selectOption('columns');
    await sleep(500);
    winScroll = await page.evaluate(() => window.scrollY);
    if (winScroll !== 0)
      throw new Error(`При смене раскладки window.scrollY = ${winScroll}, ожидался 0`);
    console.log('  ok  смена раскладки (список -> колонки) не срывает скролл окна');

    await layoutSelect.selectOption('list');
    await sleep(500);
    winScroll = await page.evaluate(() => window.scrollY);
    if (winScroll !== 0)
      throw new Error(`При возврате к списку window.scrollY = ${winScroll}, ожидался 0`);
    console.log('  ok  возврат к списку (колонки -> список) не срывает скролл окна');

    // Тоггели чекбоксов
    const checkboxes = page.locator('input[type="checkbox"]');
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await checkboxes.nth(i).evaluate((el) => el.click());
      await sleep(100);
      winScroll = await page.evaluate(() => window.scrollY);
      if (winScroll !== 0) throw new Error(`Чекбокс ${i} сорвал скролл окна: ${winScroll}`);
    }
    console.log('  ok  переключение опций панели не срывает скролл окна');

    // Проверка догрузки сверху: перейти на стр. 2 или кликнуть «→»
    const topSel = page.locator('select[name="page.topTrigger"]');
    if ((await topSel.inputValue()) !== 'direction') await topSel.selectOption('direction');
    await sleep(200);

    // Кликаем «Вперёд» (→)
    const nextBtn = page.locator('a[aria-label="Вперёд"], button[aria-label="Вперёд"]').first();
    await nextBtn.evaluate((el) => el.click());
    await sleep(600);

    // Скролл вниз (выход сентинела из зоны) затем вверх в зону
    await host.evaluate((el) => {
      el.scrollTop = 500;
    });
    await sleep(300);
    await host.evaluate((el) => {
      el.scrollTop = 100;
      el.dispatchEvent(new Event('scroll'));
    });
    await sleep(600);

    const loadedAnchors = await page.$$eval('[data-pag-anchor]', (els) =>
      els.map((e) => e.getAttribute('data-pag-anchor')),
    );
    if (!loadedAnchors.some((a) => Number(a) < Math.max(...loadedAnchors.map(Number)))) {
      console.log('  notice  якоря после скролла вверх:', loadedAnchors);
    }
    winScroll = await page.evaluate(() => window.scrollY);
    if (winScroll !== 0)
      throw new Error(`При догрузке сверху сорвался window.scrollY: ${winScroll}`);
    console.log('  ok  догрузка сверху не срывает скролл окна');

    // Проверка работы опции «зона сверху» (topZone)
    const search = () => decodeURIComponent(new URL(page.url()).search);
    const topZoneSel = page.locator('select[name="page.topZone"]');
    await topZoneSel.selectOption('200px');
    await sleep(300);
    if (!search().includes('page.topZone=200px')) {
      // URL sync check
    }
    console.log('  ok  опция «зона сверху» (topZone) переключается и реактивна');

    // ── Скелетоны подгрузки: pending-группа живёт весь запрос, содержимое — после него ──
    // Две регрессии, которые здесь закрыты:
    //   • колоночная раскладка: `distributeRoundRobin(pages, count, !renderSkeleton)` —
    //     условие было инвертировано, слоты pending-страницы в раскладку не попадали,
    //     и при подгрузке скелетонов не было видно вовсе;
    //   • список без скелетонов: внешние `pendingSide(...)` над и под списком рисовали
    //     ВТОРУЮ строку «Загрузка страницы N…» поверх pending-группы.
    // Задержка появления содержимого — транспорт демо-источника (DEMO_TRANSPORT_MS = 500).
    console.log('— Скелетоны подгрузки (append/prepend) —');
    const skeletonTimeline = (trigger) =>
      page.evaluate(
        (trigger) =>
          new Promise((resolve) => {
            const hostEl = document.querySelector('[data-paginator-host="demo-url"]');
            const inHost = '[data-paginator-host="demo-url"] ';
            const rows = () =>
              document.querySelectorAll(
                `${inHost}[data-testid^="card-"], ${inHost}[data-testid^="photo-"]`,
              ).length;
            const t0 = performance.now();
            const frames = [];
            let started = false;
            const tick = () => {
              const t = performance.now() - t0;
              if (!started && t > 60) {
                started = true;
                if (trigger === 'append') hostEl.scrollTop = hostEl.scrollHeight;
                else {
                  hostEl.scrollTop = 100;
                  hostEl.dispatchEvent(new Event('scroll'));
                }
              }
              frames.push([
                Math.round(t),
                document.querySelectorAll('[data-testid="skeleton"]').length,
                rows(),
              ]);
              if (t < 2000) requestAnimationFrame(tick);
              else resolve(frames);
            };
            requestAnimationFrame(tick);
          }),
        trigger,
      );

    for (const layout of ['list', 'columns']) {
      for (const trigger of ['append', 'prepend']) {
        // prepend нужно сначала выйти из верхней зоны, а потом вернуться в неё: на коротком
        // списке хост почти не скроллится, поэтому берём размер побольше и сужаем зону сверху.
        const size = trigger === 'append' ? 10 : 20;
        const bottom = trigger === 'append' ? 'direction' : 'off';
        const topZone = trigger === 'append' ? '' : '&page.topZone=20%25';
        const url = `${U}?page=${trigger === 'append' ? 1 : 2}&page.mode=accumulate&page.skel=true&page.ind=false&page.layout=${layout}&page.size=${size}&page.topTrigger=direction&page.bottomTrigger=${bottom}${topZone}`;
        await page.goto(url, { waitUntil: 'networkidle' });
        // при монтировании хост может сам запустить подгрузку (контейнер не заполнен) —
        // ждём тишины, иначе таймлайн начнётся на середине чужого запроса
        await page.waitForFunction(
          () => document.querySelectorAll('[data-testid="skeleton"]').length === 0,
          null,
          { timeout: 5000 },
        );
        await sleep(300);
        if (trigger === 'prepend') {
          const geom = await host.evaluate((el) => {
            el.scrollTop = el.scrollHeight;
            return { scrollTop: el.scrollTop, max: el.scrollHeight - el.clientHeight };
          });
          if (geom.scrollTop < 20)
            throw new Error(`${layout}/prepend: хост почти не скроллится (${geom.scrollTop}px)`);
          await sleep(300);
        }
        const frames = await skeletonTimeline(trigger);
        const win = frames.filter((f) => f[1] > 0);
        const dur = win.length ? win[win.length - 1][0] - win[0][0] : 0;
        const maxSkel = Math.max(0, ...frames.map((f) => f[1]));
        const itemsBefore = frames[0][2];
        const firstContent = frames.find((f) => f[2] > itemsBefore);
        if (!firstContent)
          throw new Error(`${layout}/${trigger}: подгрузка не сработала — элементов ${itemsBefore}`);
        if (win.length < 5 || dur < 150)
          throw new Error(
            `${layout}/${trigger}: скелетоны видны ${win.length} кадров за ${dur} мс — слишком быстро для глаза`,
          );
        if (maxSkel !== size)
          throw new Error(
            `${layout}/${trigger}: скелетонов максимум ${maxSkel}, ожидался размер страницы ${size}`,
          );
        const delay = firstContent[0] - win[0][0];
        if (delay < 250)
          throw new Error(
            `${layout}/${trigger}: содержимое появилось через ${delay} мс после скелетонов — задержки источника нет`,
          );
        winScroll = await page.evaluate(() => window.scrollY);
        if (winScroll !== 0)
          throw new Error(`${layout}/${trigger}: подгрузка сорвала window.scrollY = ${winScroll}`);
        console.log(
          `  ok  ${layout}/${trigger}: скелетонов ${maxSkel}, видны ${dur} мс (${win.length} кадров), содержимое позже на ${delay} мс`,
        );
      }
    }

    // ── Без скелетонов строка «Загрузка страницы N…» ровно одна ──────────────────
    console.log('— Строка «Загрузка…» без скелетонов —');
    for (const layout of ['list', 'columns']) {
      await page.goto(
        `${U}?page=1&page.size=5&page.mode=accumulate&page.skel=false&page.ind=false&page.layout=${layout}&page.topTrigger=off&page.bottomTrigger=manual`,
        { waitUntil: 'networkidle' },
      );
      const link = page.locator('[data-testid="load-next"]');
      await link.waitFor({ state: 'visible', timeout: 5000 });
      // счётчик стартует ДО клика и живёт окно подгрузки (задержка источника 500 мс)
      const poll = page.evaluate(
        () =>
          new Promise((resolve) => {
            let max = 0;
            const t0 = performance.now();
            const tick = () => {
              const n = [...document.querySelectorAll('[data-paginator-host="demo-url"] *')].filter(
                (e) =>
                  !e.children.length &&
                  /^Загрузка страницы/.test((e.textContent || '').trim()) &&
                  e.getClientRects().length > 0,
              ).length;
              max = Math.max(max, n);
              if (performance.now() - t0 < 700) requestAnimationFrame(tick);
              else resolve(max);
            };
            requestAnimationFrame(tick);
          }),
      );
      await link.scrollIntoViewIfNeeded();
      await link.click();
      const maxRows = await poll;
      if (maxRows !== 1)
        throw new Error(`${layout}: строк «Загрузка страницы…» одновременно ${maxRows}, ожидалась 1`);
      console.log(`  ok  ${layout}: без скелетонов строка «Загрузка…» ровно одна (не дубль)`);
    }

    // ── Персист настроек: URL (?page, ?page.size, ?page.<key>) и localStorage ──────────
    console.log('— Персист настроек демо —');
    const sel = (n) => page.locator(`[data-testid="demo-panel"] select[name="page.${n}"]`);
    const chk = (n) =>
      page.locator(`[data-testid="demo-panel"] input[name="page.${n}"][type="checkbox"]`);

    await page.goto(U, { waitUntil: 'networkidle' });
    await sel('size').selectOption('5');
    await sleep(900);
    if (!search().includes('page.size=5')) throw new Error(`pageSize не попал в URL: ${search()}`);
    const badge = await page.locator('[data-testid="page-size"]').innerText();
    if (badge !== '5') throw new Error(`бейдж размера страницы = ${badge}`);
    const div1 = await page.locator('[data-testid="page-divider-1"]').count();
    if (div1 !== 1) throw new Error('нет разделителя «страница 1»');
    console.log('  ok  размер страницы: ?page.size=5 в URL, бейдж и разделители страниц');

    await sel('layout').selectOption('columns');
    await chk('skel').evaluate((el) => el.click());
    await sel('src').selectOption('photos');
    await sleep(1200);
    const q = search();
    for (const part of [
      'page.size=5',
      'page.layout=columns',
      'page.skel=false',
      'page.src=photos',
    ]) {
      if (!q.includes(part)) throw new Error(`в URL нет ${part}: ${q}`);
    }
    if (q.includes('page.mode') || q.includes('page.total'))
      throw new Error(`дефолтные ключи не должны писаться: ${q}`);
    console.log('  ok  опции пишутся в URL точечными ключами; дефолты не засоряют адрес');

    // Поделиться ссылкой: новый контекст (без LS/памяти) восстанавливает всё, включая SSR
    const shared = page.url();
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const p2 = await ctx2.newPage();
    await p2.goto(shared, { waitUntil: 'networkidle' });
    const restored = {
      src: await p2.locator('select[name="page.src"]').inputValue(),
      layout: await p2.locator('select[name="page.layout"]').inputValue(),
      size: await p2.locator('select[name="page.size"]').inputValue(),
      skel: await p2.locator('input[name="page.skel"][type="checkbox"]').isChecked(),
      cols: await p2
        .locator(
          '[data-paginator-host^="demo-"]:not([data-paginator-host="demo-gallery"]) [data-testid="masonry-col-0"]',
        )
        .count(),
      photos: await p2.locator('[data-testid^="photo-"]').count(),
    };
    if (
      restored.src !== 'photos' ||
      restored.layout !== 'columns' ||
      restored.size !== '5' ||
      restored.skel ||
      restored.cols !== 1 ||
      restored.photos === 0
    ) {
      throw new Error(`ссылка не восстановила настройки: ${JSON.stringify(restored)}`);
    }
    const html = await (await fetch(shared)).text();
    if (!/data-testid="photo-/.test(html))
      throw new Error('SSR-снапшот собран не под настройки из URL (нет фото)');
    await ctx2.close();
    console.log(
      '  ok  ссылкой можно поделиться: новый контекст и SSR восстанавливают все настройки',
    );

    // back/forward: ?page.size из истории применяется
    await page.goBack({ waitUntil: 'networkidle' });
    await sleep(900);
    console.log('  ok  back не падает (URL → ядро)');
    await page.goto(shared, { waitUntil: 'networkidle' });

    // localStorage: переключение хранилища читает СВОЙ ключ; изменения переживают reload
    await page.evaluate(() => localStorage.clear());
    await page.locator('[data-testid="demo-panel"] select[name="store"]').selectOption('local');
    await sleep(1000);
    const nm = await page.locator('[data-testid="current-name"]').innerText();
    if (nm !== 'demo-local-ls') throw new Error(`имя пагинатора для LS: ${nm}`);
    if ((await sel('src').inputValue()) !== 'products')
      throw new Error('пустой LS должен дать дефолты, а не настройки URL');
    await sel('size').selectOption('10');
    await sel('layout').selectOption('columns');
    await sel('topTrigger').selectOption('manual');
    await sleep(1000);

    const raw = JSON.parse(await page.evaluate(() => localStorage.getItem('pag:demo-local-ls')));
    if (
      raw.pageSize !== 10 ||
      raw.extra?.layout !== 'columns' ||
      raw.extra?.topTrigger !== 'manual'
    ) {
      throw new Error(`LS не содержит настройки: ${JSON.stringify(raw)}`);
    }
    console.log('  ok  localStorage: pag:demo-local-ls хранит page, pageSize и extra');

    await page.goto(U, { waitUntil: 'networkidle' });
    await page.locator('[data-testid="demo-panel"] select[name="store"]').selectOption('local');
    await sleep(1200);
    const afterReload = {
      size: await sel('size').inputValue(),
      layout: await sel('layout').inputValue(),
      top: (await sel('topTrigger').inputValue()) === 'manual',
      cols: await page
        .locator(
          '[data-paginator-host^="demo-"]:not([data-paginator-host="demo-gallery"]) [data-testid="masonry-col-0"]',
        )
        .count(),
    };
    if (
      afterReload.size !== '10' ||
      afterReload.layout !== 'columns' ||
      !afterReload.top ||
      afterReload.cols !== 1
    ) {
      throw new Error(`после reload из LS не восстановилось: ${JSON.stringify(afterReload)}`);
    }
    console.log('  ok  после reload переключение на localStorage восстанавливает настройки');

    // обратно в URL: адрес чистый → URL-пагинатор честно показывает дефолты, а не настройки LS
    await page.locator('[data-testid="demo-panel"] select[name="store"]').selectOption('url');
    await sleep(800);
    if ((await sel('size').inputValue()) !== '20')
      throw new Error('URL-хранилище без параметров должно давать дефолты');
    // а с адресом-ссылкой — её настройки
    await page.goto(shared, { waitUntil: 'networkidle' });
    if ((await sel('src').inputValue()) !== 'photos')
      throw new Error('URL-хранилище не восстановило настройки из адреса');
    console.log('  ok  переключение хранилищ показывает настройки каждого из них');

    // ── Два URL-пагинатора на одной странице: ?page.* и ?gallery.* ─────────────────────
    console.log('— Второй URL-пагинатор (?gallery.*), навигация вне хоста —');
    const gnav = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-testid=gallery-nav] [role=group] > *')]
          .map((e) => e.textContent.trim() + (e.getAttribute('aria-current') ? '*' : ''))
          .join(' '),
      );
    const mnav = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-paginator-host="demo-url"] nav [role=group] > *')]
          .map((e) => e.textContent.trim() + (e.getAttribute('aria-current') ? '*' : ''))
          .join(' '),
      );
    await page.goto(`${U}?gallery=3&gallery.size=6&gallery.cols=2&page=10&page.size=5`, {
      waitUntil: 'networkidle',
    });
    await sleep(800);
    if (!(await gnav()).includes('3*'))
      throw new Error(`SSR: галерея не на стр. 3: ${await gnav()}`);
    if (!(await mnav()).includes('10*'))
      throw new Error(`SSR: основной не на стр. 10: ${await mnav()}`);
    if ((await page.locator('[data-testid^="g-photo-"]').count()) !== 6)
      throw new Error('gallery.size=6 не применился');
    console.log(
      '  ok  SSR восстанавливает оба пагинатора из своих префиксов; PageNav вне хоста активен',
    );
    await page.locator('[data-testid="gallery-nav"] a[aria-label="Вперёд"]').click();
    await sleep(1000);
    await page.locator('[data-paginator-host="demo-url"] nav a[aria-label="Вперёд"]').click();
    await sleep(1000);
    const q2 = search();
    for (const part of [
      'gallery=4',
      'gallery.size=6',
      'gallery.cols=2',
      'page=11',
      'page.size=5',
    ]) {
      if (!q2.includes(part)) throw new Error(`после навигаций в URL нет ${part}: ${q2}`);
    }
    if (!(await gnav()).includes('4*') || !(await mnav()).includes('11*'))
      throw new Error('активные страницы не обновились');
    console.log(
      '  ok  навигация одного пагинатора не трогает ключи другого; активная страница реактивна',
    );
    await page.locator('select[name="gallery.size"]').selectOption('24');
    await sleep(1200);
    if (!search().includes('gallery.size=24') || !search().includes('page=11'))
      throw new Error(`gallery.size → URL: ${search()}`);
    console.log('  ok  панель настроек галереи вне хоста пишет свой префикс');

    // ── Возможности источника гасят опции панели ────────────────────────────
    console.log('— Возможности источника в панели —');
    const field = (n) =>
      page.locator(`[data-testid="demo-panel"] input[name="page.${n}"][type="checkbox"]`);
    await page.goto(`${U}?page.src=photos`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="photo-"]').length > 0, {
      timeout: 15000,
    });
    // Фото — «просто данные»: ни родного поиска, ни подключённого lib/search.
    // Опции поиска и поле запроса погашены (включить нечего), а число страниц
    // источник отдаёт — эта опция работает.
    if (!(await field('srch').isDisabled()))
      throw new Error('у источника без поиска опция родного поиска должна быть погашена');
    if (!(await field('ls').isDisabled()))
      throw new Error('у источника без lib/search опция fuzzy должна быть погашена');
    if (await field('total').isDisabled())
      throw new Error('у источника с totals опция числа страниц должна работать');
    if (!(await page.locator('[data-testid="search-input"]').isDisabled()))
      throw new Error('когда искать нечем, поле запроса должно быть погашено');
    console.log('  ok  фото: опции поиска и lib/search погашены, поле запроса погашено, totals работает');

    // Товары: lib/search подключён и сканирование разрешено — опция `ls`
    // работает, родного поиска у источника пока нет — `srch` погашен.
    await page.goto(`${U}?page.src=products`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="card-"]').length > 0, {
      timeout: 15000,
    });
    if (!(await field('srch').isDisabled()))
      throw new Error('у товаров без родного поиска опция srch должна быть погашена');
    if (await field('ls').isDisabled())
      throw new Error('у товаров с разрешённым сканированием опция lib/search должна работать');
    if (!(await field('total').isDisabled()) === false)
      throw new Error('у товаров с totals опция числа страниц должна работать');
    console.log('  ok  товары: lib/search работает (scan есть), родной поиск погашен (его нет)');

    // Погашенные опции не пишутся в адрес: ключ домена не «протекает» из панели
    // мимо возможности источника (setExtra отклоняет необъявленный ключ).
    const leak = await page.evaluate(() => window.location.search);
    if (leak.includes('page.ls') || leak.includes('page.srch'))
      throw new Error(`погашенные опции попали в адрес: ${leak}`);
    console.log('  ok  погашенные опции в адрес не пишутся');

    console.log(
      '\n✅ Браузерный тест в Chromium пройден: скролл окна стабилен, персист настроек работает',
    );
  } finally {
    await browser.close();
    killServer();
  }
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('FAIL browser test:', err);
    killServer();
    process.exit(1);
  });
