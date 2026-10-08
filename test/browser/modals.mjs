/**
 * ПОРТ test/browser/modals.mjs оригинала (SolidHono) — адаптация минимальная:
 *   • маршрут демо — как у оригинала (/modals);
 *   • прод-сервер: не поднимается скриптом — тест идёт на УЖЕ работающий
 *     `vite preview` (npm run build && npm run preview), адрес в MODALS_BASE;
 *   • Playwright — зависимость среды прогона, НЕ проекта (в package.json
 *     порта его нет: «зависимостей сверх закреплённых не добавлять»).
 *     Запуск:
 *       npm run build && npm run preview &
 *       node test/browser/modals.mjs    # playwright виден через симлинк/переменную
 *
 * Сценарии (по ТЗ порта) — без изменений:
 *   1. открытие 1 → 2 → 3 слоёв; классы / data-anchor / transform хвостов;
 *   2. Esc закрывает только верхний слой;
 *   3. клик по фону (backdropClick=top) закрывает верхний;
 *   4. history.back/forward закрывает/открывает верхнюю;
 *   5. перезагрузка с ?modal=… восстанавливает стопку;
 *   6. ленивая модалка: скелетон → контент (кадры pulse из пресета, раскрытие переходом);
 *   7. несуществующая → [data-modal-error];
 *   8. «Закрыть все»;  9. lock + «Закрыть принудительно»;
 *  10. prefers-reduced-motion.
 *
 * Скриншоты: node_modules/.screens/modals/port/*.png (или MODALS_SHOT_DIR).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const PORT = Number(process.env.MODALS_PORT ?? 4173);
const BASE = process.env.MODALS_BASE ?? `http://127.0.0.1:${PORT}/modals`;
const SHOT_DIR = path.resolve(process.env.MODALS_SHOT_DIR ?? 'node_modules/.screens/modals/port');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const ok = (name) => {
  passed++;
  console.log('  ok  ' + name);
};
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
/** Дождаться, пока число слоёв станет >= n (учитывает preload до 3 с). */
async function waitForLayers(page, n, timeout = 6000) {
  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-modal-layer]').length >= count,
    n,
    { timeout },
  );
}
async function waitForNoModal(page, timeout = 6000) {
  await page.waitForFunction(
    () => document.querySelectorAll('[data-modal-stage]').length === 0,
    null,
    { timeout },
  );
}
/** Вместо startLocalServer оригинала: ждём уже поднятый `vite preview`. */
async function waitPreview() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`прод-сервер не отвечает: ${BASE} (npm run preview)`);
}

async function run() {
  await waitPreview();
  mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  try {
    // ── 0. Панель настроек на узком экране — select-поля механизма (этап 8) ──
    {
      console.log('— Настройки хоста: компактный select, первый пункт «выкл» —');
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.goto(BASE, { waitUntil: 'networkidle' });
      const sel = page.locator('#default_mobile');
      const state = await sel.evaluate((el) => ({
        tag: el.tagName,
        name: el.getAttribute('name'),
        firstLabel: el.options[0]?.textContent.trim(),
        value: el.value,
        fits: el.scrollWidth <= el.clientWidth + 1,
      }));
      assert(state.tag === 'SELECT' && state.name === 'default_mobile',
        `поле механизма не найдено: ${JSON.stringify(state)}`);
      assert(state.firstLabel === 'выкл', `первый пункт не «выкл»: ${state.firstLabel}`);
      assert(state.value === 'off' && state.fits, `селектор не отражает «выкл» или не влезает: ${JSON.stringify(state)}`);
      ok('настройки — поля form: select с опцией «выкл» помещается на 390px');
      await page.close();
    }

    // ── 0. Триггеры no-JS и после гидратации ────────────────────────────────
    {
      console.log('— ModalTrigger: route до гидратации, client-only после —');
      const page = await browser.newPage({
        viewport: { width: 1280, height: 860 },
        javaScriptEnabled: false,
      });
      await page.goto(BASE, { waitUntil: 'networkidle' });

      const initialSettings = await page.evaluate(() => {
        const fieldsets = [...document.querySelectorAll('[data-js-only-settings]')]
        return {
          count: fieldsets.length,
          disabled: fieldsets.map((node) => node instanceof HTMLFieldSetElement && node.disabled),
          controlsDisabled: fieldsets.map((node) => [...node.querySelectorAll('button,input,select,textarea')]
            .some((control) => control.matches(':disabled'))),
          routeLinks: ['/','/cycle'].map((href) => [...document.querySelectorAll('a')]
            .some((link) => link.getAttribute('href') === href && !link.matches(':disabled'))),
        }
      })
      assert(initialSettings.count === 1
        && initialSettings.disabled.every(Boolean)
        && initialSettings.controlsDisabled.every(Boolean), `no-JS settings: ${JSON.stringify(initialSettings)}`)
      ok('без JS настройки модалки и источников выключены');
      // Этап 8: под гейтом и панель настроек (8 select'ов механизма) — все
      // контролы поля; источниковый select (нативный слой кастомного виджета)
      // тоже обязан быть выключен до гидратации.
      const selectsDisabled = await page.locator('[data-js-only-settings] select').evaluateAll((nodes) =>
        nodes.length === 9 && nodes.every((n) => n.matches(':disabled')));
      assert(selectsDisabled, 'no-JS: не все select панели/источников выключены');
      const sourceSelect = page.locator('[data-js-only-settings] [data-select-native]');
      assert((await sourceSelect.count()) === 1 && await sourceSelect.first().evaluate((n) => n.matches(':disabled')),
        'no-JS Select источников не выключен');
      ok('без JS выключены оба блока: панель настроек (9 select) и Select источников');
      assert(initialSettings.routeLinks.every(Boolean), `no-JS route links: ${JSON.stringify(initialSettings.routeLinks)}`)
      ok('без JS ссылки на главную и цикл остаются доступны');

      const card = page.locator('[data-modal-trigger]', { hasText: 'Открыть карточку' }).first();
      const cardState = await card.evaluate((el) => ({
        tag: el.tagName,
        href: el.getAttribute('href'),
        disabled: el.matches(':disabled'),
      }));
      assert(cardState.tag === 'A' && cardState.href === '/cards/7' && !cardState.disabled, `no-JS route trigger: ${JSON.stringify(cardState)}`);
      ok('без JS route-триггер остаётся доступной ссылкой /cards/7');

      for (const label of ['Полноэкранная', 'Проверить наследование', 'Select внутри модалки', 'Несуществующая', 'Битый route']) {
        const trigger = page.locator('[data-modal-trigger]', { hasText: label }).first();
        const state = await trigger.evaluate((el) => ({
          tag: el.tagName,
          disabled: el instanceof HTMLButtonElement && el.disabled,
          href: el.getAttribute('href'),
        }));
        assert(state.tag === 'BUTTON' && state.disabled && state.href === null, `no-JS ${label} доступен: ${JSON.stringify(state)}`);
        ok(`без JS «${label}» неактивен`);
      }
      await card.click();
      await page.waitForURL((url) => url.pathname === '/cards/7', { timeout: 10000 });
      ok('без JS ссылка-триггер внутри отключённой панели открывает route /cards/7');
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.getByRole('link', { name: 'Цикл', exact: true }).click();
      await page.waitForURL((url) => url.pathname === '/cycle', { timeout: 10000 });
      ok('без JS ссылка действительно переводит на /cycle');
      await page.close();

      const hydrated = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      await hydrated.goto(BASE, { waitUntil: 'networkidle' });
      await hydrated.waitForFunction(() => {
        const trigger = [...document.querySelectorAll('[data-modal-trigger]')].find((el) => el.textContent?.includes('Полноэкранная'));
        const settings = [...document.querySelectorAll('[data-js-only-settings]')]
        return trigger && !trigger.hasAttribute('data-pending')
          && settings.length === 1
          && settings.every((node) => node instanceof HTMLFieldSetElement && !node.disabled)
      }, null, { timeout: 20000 });
      ok('после гидратации настройки модалки и источников включены');
      // Этап 8: после гидратации — те же 9 select'ов (источниковый остаётся
      // нативным слоем кастомного виджета), панель настроек включена.
      const selectsEnabled = await hydrated.locator('[data-js-only-settings] select').evaluateAll((nodes) =>
        nodes.length === 9 && nodes.every((n) => !n.matches(':disabled')));
      assert(selectsEnabled, 'после гидратации поля настроек/источников не включились');
      ok('после гидратации Select источников включён');
      const fullpage = hydrated.locator('[data-modal-trigger]', { hasText: 'Полноэкранная' }).first();
      const fullpageState = await fullpage.evaluate((el) => ({ tag: el.tagName, href: el.getAttribute('href') }));
      assert(fullpageState.tag === 'A' && fullpageState.href?.includes('modal=fullpage'), `hydrated route-less trigger: ${JSON.stringify(fullpageState)}`);
      ok('после гидратации обычная client-only модалка доступна');
      for (const label of ['Несуществующая', 'Битый route']) {
        const trigger = hydrated.locator('[data-modal-trigger]', { hasText: label }).first();
        const state = await trigger.evaluate((el) => ({
          tag: el.tagName,
          disabled: el instanceof HTMLButtonElement && el.disabled,
        }));
        assert(state.tag === 'BUTTON' && state.disabled, `невалидный сценарий «${label}» включился: ${JSON.stringify(state)}`);
        ok(`после гидратации сценарий «${label}» остаётся выключенным`);
      }
      await fullpage.click();
      await hydrated.locator('[data-modal-layer][data-active]').waitFor({ state: 'visible', timeout: 5000 });
      ok('гидратированный client-only триггер открывает модалку');
      await hydrated.keyboard.press('Escape');
      await waitForNoModal(hydrated);
      await hydrated.close();
    }

    // ── 1. Слои, классы, data-anchor, transform хвостов ─────────────────────
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      console.log('— Слои 1→2→3, классы, data-anchor, transform —');
      await page.goto(BASE, { waitUntil: 'networkidle' });

      await page.locator('[data-modal-trigger]', { hasText: 'Открыть карточку' }).first().click();
      await page.locator('[data-modal-stage]').waitFor({ state: 'visible', timeout: 5000 });
      ok('1 слой: [data-modal-stage] виден, backdrop на месте');
      const anchor1 = await page.locator('[data-modal-stage]').getAttribute('data-anchor');
      assert(anchor1 === 'center', `data-anchor=${anchor1}, ожидалось center`);
      ok('data-anchor="center" на desktop');

      await page
        .locator('[data-modal-layer][data-active] [data-modal-trigger]', { hasText: 'Открыть ещё одну' })
        .click();
      await waitForLayers(page, 2);
      ok('2 слоя: нижний слой остался смонтированным');

      const tail = page.locator('[data-modal-tail]').first();
      await tail.waitFor({ state: 'attached', timeout: 5000 });
      await sleep(500); // дождаться transition «ухода в стопку»
      const tf = await tail.evaluate((el) => getComputedStyle(el).transform);
      assert(tf && tf !== 'none', 'transform хвоста = none, ожидался translate3d(...)');
      ok('хвост: transform = ' + tf.slice(0, 30) + '…');
      const z = await tail.evaluate((el) => getComputedStyle(el).zIndex);
      assert(Number(z) < 0, `z-index хвоста=${z}, ожидался отрицательный`);
      ok('хвост: z-index отрицательный (под активной оболочкой)');

      await page
        .locator('[data-modal-layer][data-active] [data-modal-trigger]', { hasText: 'Открыть ещё одну' })
        .click();
      await waitForLayers(page, 3);
      const tails3 = await page.locator('[data-modal-tail]').count();
      assert(tails3 >= 2, `хвостов=${tails3}, ожидалось >=2`);
      ok('3 слоя: хвостов ' + tails3);

      const tprop = await page
        .locator('[data-modal-popup]')
        .first()
        .evaluate((el) => getComputedStyle(el).transitionProperty);
      assert(tprop && !/none/.test(tprop), 'transition-property у [data-modal-popup] отсутствует');
      ok('transition-property у [data-modal-popup]: ' + tprop.slice(0, 40));

      await sleep(400);
      await page.screenshot({ path: path.join(SHOT_DIR, '3-layers.png') });
      ok('скриншот: 3-layers.png');
      await page.close();
    }

    // ── 2. Esc — только верхний ─────────────────────────────────────────────
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      console.log('— Esc закрывает только верхний слой —');
      await page.goto(BASE + '?modal=card&modal.0.id=7', { waitUntil: 'networkidle' });
      await page.locator('[data-modal-stage]').waitFor({ state: 'visible', timeout: 5000 });
      await page
        .locator('[data-modal-layer][data-active] [data-modal-trigger]', { hasText: 'Открыть ещё одну' })
        .click();
      await waitForLayers(page, 2);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelectorAll('[data-modal-layer]').length === 1, null, { timeout: 5000 });
      ok('Esc закрыл верхний, нижний остался (1 слой)');
      await page.keyboard.press('Escape');
      await waitForNoModal(page);
      ok('повторный Esc закрыл последний слой');
      await page.close();
    }

    // ── 3. Клик по фону (backdropClick=top) ─────────────────────────────────
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      console.log('— Клик по фону —');
      await page.goto(BASE + '?modal=card&modal.0.id=7', { waitUntil: 'networkidle' });
      await page.locator('[data-modal-stage]').waitFor({ state: 'visible', timeout: 5000 });
      await page.mouse.click(8, 8); // угол viewport — точно вне stage
      await waitForNoModal(page);
      ok('клик по фону закрыл модалку (backdropClick=top)');
      await page.close();
    }

    // ── 4. history.back/forward ─────────────────────────────────────────────
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      console.log('— history.back / forward —');
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.locator('[data-modal-trigger]', { hasText: 'Открыть карточку' }).first().click();
      await page.locator('[data-modal-stage]').waitFor({ state: 'visible', timeout: 5000 });
      await page
        .locator('[data-modal-layer][data-active] [data-modal-trigger]', { hasText: 'Открыть ещё одну' })
        .click();
      await waitForLayers(page, 2);
      await page.goBack();
      await page.waitForFunction(() => document.querySelectorAll('[data-modal-layer]').length === 1, null, { timeout: 5000 });
      ok('history.back() закрыл верхний слой');
      await page.goForward();
      await waitForLayers(page, 2);
      ok('history.forward() вернул верхний слой');
      await page.close();
    }

    // ── 5. Перезагрузка с ?modal=… ─────────────────────────────────────────
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      console.log('— Перезагрузка с ?modal=… —');
      await page.goto(BASE + '?modal=card,card&modal.0.id=7', { waitUntil: 'networkidle' });
      await page.locator('[data-modal-stage]').waitFor({ state: 'visible', timeout: 5000 });
      assert((await page.locator('[data-modal-layer]').count()) >= 2, 'стопка из URL не восстановилась');
      ok('холодный запуск: стопка из ?modal=… восстановлена');
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('[data-modal-stage]').waitFor({ state: 'visible', timeout: 5000 });
      assert((await page.locator('[data-modal-layer]').count()) >= 2, 'после reload стопка потеряна');
      ok('перезагрузка сохранила стопку');
      await page.close();
    }

    // ── 6. Ленивая модалка: скелетон → контент ─────────────────────────────
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      console.log('— Ленивая модалка: скелетон → контент —');
      await page.goto(BASE + '?modal=card&modal.0.slow=true', { waitUntil: 'networkidle' });
      await page.locator('[data-modal-stage]').waitFor({ state: 'visible', timeout: 5000 });
      await page.locator('[data-modal-skeleton]').waitFor({ state: 'visible', timeout: 5000 });
      const pulse = await page
        .locator('[data-modal-skeleton-line]')
        .first()
        .evaluate((el) => getComputedStyle(el).animationName);
      // Кадры `pulse` — встроенные кадры presetWind4, своих у системы нет.
      assert(pulse === 'pulse', `animationName=${pulse}, ожидался pulse`);
      ok('скелетон: animation-name=pulse (встроенные кадры пресета)');
      await page.screenshot({ path: path.join(SHOT_DIR, 'skeleton.png') });
      ok('скриншот: skeleton.png');

      /*
        Раскрытие содержимого — теперь переход из @starting-style, а не
        анимация, поэтому и проверка поведенческая: следим за прозрачностью
        с момента появления узла и ждём, что она пришла ИЗ нуля (появление
        «из ничего» отличимо от мгновенной вставки).
      */
      await page.evaluate(() => {
        window.__revealMin = 1;
        const started = performance.now();
        const tick = () => {
          const el = document.querySelector('[data-modal-reveal]');
          if (el) {
            const o = Number(getComputedStyle(el).opacity);
            if (Number.isFinite(o) && o < window.__revealMin) window.__revealMin = o;
          }
          if (performance.now() - started < 2500) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

      await page.locator('[data-modal-content]').waitFor({ state: 'visible', timeout: 9000 });
      const reveal = await page
        .locator('[data-modal-reveal]')
        .first()
        .evaluate((el) => {
          const cs = getComputedStyle(el);
          return {
            property: cs.transitionProperty,
            duration: cs.transitionDuration,
            easing: cs.transitionTimingFunction,
          };
        });
      const minOpacity = await page.evaluate(() => window.__revealMin);
      assert(
        /opacity/.test(reveal.property),
        `у раскрытия нет перехода по opacity: ${reveal.property}`,
      );
      assert(
        /0\.26s|260ms/.test(reveal.duration),
        `длительность раскрытия ${reveal.duration}, ожидалась 260ms`,
      );
      assert(minOpacity < 0.5, `раскрытие началось с opacity=${minOpacity}, а не с нуля`);
      ok(
        `контент появился после загрузчика: переход opacity за ${reveal.duration}, минимум ${minOpacity.toFixed(3)}`,
      );
      await page.close();
    }

    // ── 7. Несуществующая → [data-modal-error] ───────────────────────────────────
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      console.log('— Несуществующая модалка → [data-modal-error] —');
      await page.goto(BASE + '?modal=ghost', { waitUntil: 'networkidle' });
      await page.locator('[data-modal-error]').waitFor({ state: 'visible', timeout: 5000 });
      const msg = await page.locator('[data-modal-error]').innerText();
      assert(msg.includes('ghost'), 'в [data-modal-error] нет имени: ' + msg);
      ok('ошибка «нет такой модалки» отрендерилась');
      await page.screenshot({ path: path.join(SHOT_DIR, 'error.png') });
      ok('скриншот: error.png');
      await page.close();
    }

    // ── 8. Закрыть все ─────────────────────────────────────────────────────
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      console.log('— «Закрыть все» —');
      await page.goto(BASE + '?modal=card,card,card', { waitUntil: 'networkidle' });
      await page.locator('[data-modal-stage]').waitFor({ state: 'visible', timeout: 5000 });
      await page
        .locator('[data-modal-layer][data-active] [data-modal-btn]', { hasText: 'Закрыть все' })
        .click();
      await waitForNoModal(page);
      ok('«Закрыть все» очистило стопку');
      await page.close();
    }

    // ── 9. lock + «Закрыть принудительно» ──────────────────────────────────
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      console.log('— lock + «Закрыть принудительно» —');
      await page.goto(BASE + '?modal=locked', { waitUntil: 'networkidle' });
      await page.locator('[data-modal-stage]').waitFor({ state: 'visible', timeout: 5000 });
      await page.keyboard.press('Escape');
      await sleep(500);
      assert((await page.locator('[data-modal-stage]').count()) === 1, 'Esc закрыл заблокированную');
      ok('Esc не закрыл заблокированную модалку');
      await page.locator('button', { hasText: 'Закрыть принудительно' }).first().click();
      await waitForNoModal(page);
      ok('«Закрыть принудительно» закрыло заблокированную');
      await page.close();
    }

    // ── 10. prefers-reduced-motion ─────────────────────────────────────────
    {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 860 },
        reducedMotion: 'reduce',
      });
      const page = await ctx.newPage();
      console.log('— prefers-reduced-motion —');
      await page.goto(BASE + '?modal=card&modal.0.id=7', { waitUntil: 'networkidle' });
      await page.locator('[data-modal-stage]').waitFor({ state: 'visible', timeout: 5000 });
      const dur = await page
        .locator('[data-modal-popup]')
        .first()
        .evaluate((el) => getComputedStyle(el).transitionDuration);
      assert(/1ms|0\.001s/.test(dur), `transitionDuration=${dur}, ожидалось 1ms (reduced-motion)`);
      ok('reduced-motion: transition-duration = ' + dur);
      await ctx.close();
    }

    // ── Скриншоты: fullpage, 1 слой ────────────────────────────────────────
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      console.log('— Скриншоты: fullpage, 1 слой —');
      await page.goto(BASE + '?modal=fullpage', { waitUntil: 'networkidle' });
      await page.locator('[data-modal-stage]').waitFor({ state: 'visible', timeout: 5000 });
      assert((await page.locator('[data-modal-stage]').getAttribute('data-fullpage')) !== null, 'нет data-fullpage');
      ok('fullpage: data-fullpage на месте');
      await sleep(400);
      await page.screenshot({ path: path.join(SHOT_DIR, 'fullpage.png') });
      ok('скриншот: fullpage.png');

      await page.goto(BASE + '?modal=card&modal.0.id=7', { waitUntil: 'networkidle' });
      await page.locator('[data-modal-stage]').waitFor({ state: 'visible', timeout: 5000 });
      await sleep(500);
      await page.screenshot({ path: path.join(SHOT_DIR, '1-layer.png') });
      ok('скриншот: 1-layer.png');
      await page.close();
    }

    // ── Скриншоты: мобильные якоря ─────────────────────────────────────────
    {
      console.log('— Скриншоты: мобильные якоря —');
      for (const anchor of ['top', 'bottom', 'left', 'right']) {
        const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
        await page.goto(
          BASE + `?modal=card&modal.0.id=7&modal.0.mobile=${anchor}`,
          { waitUntil: 'networkidle' },
        );
        await page.locator('[data-modal-stage]').waitFor({ state: 'visible', timeout: 5000 });
        await sleep(300);
        const got = await page.locator('[data-modal-stage]').getAttribute('data-anchor');
        assert(got === anchor, `data-anchor=${got}, ожидалось ${anchor}`);
        ok('мобильный якорь ' + anchor + ' → data-anchor=' + got);
        await page.screenshot({ path: path.join(SHOT_DIR, `anchor-${anchor}.png`) });
        await page.close();
      }
    }

    console.log(`\n✅ modals-browser: ${passed} проверок пройдено`);
  } finally {
    await browser.close().catch(() => {});
  }
}

run().catch((e) => {
  console.error('\n❌ modals-browser: ' + (e && e.message ? e.message : e));
  process.exit(1);
});
