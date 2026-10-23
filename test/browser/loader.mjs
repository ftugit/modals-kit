/**
 * Browser-тесты глобального лоадера (`components/loader`, src/lib/task/README.md):
 *   • медленный переход SvelteKit зажигает полоску сверху (без процента) и гасит её;
 *   • быстрый переход и открытие модалки полоску не зажигают (задержка 150 мс);
 *   • без JS полоски в разметке нет;
 *   • кнопка с `task` (отправка формы): спиннер на нажатой, полоска, после ответа всё снято;
 *   • пагинатор: спиннер у грузящейся страницы, в поле поиска и у «Сброс»;
 *   • ход сервера строками: полоса с подписью и процент у страницы списка и на кнопке формы.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const PORT = Number(process.env.MODALS_PORT ?? 5173);
const BASE = process.env.MODALS_BASE ?? `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const ok = (name) => {
  passed++;
  console.log("  ok  " + name);
};

async function waitPreview() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`сервер не отвечает: ${BASE}`);
}

/** Счётчик появлений полоски за время жизни страницы. */
const COUNT_BAR = () => {
  window.__bars = 0;
  new MutationObserver(() => {
    const bar = document.querySelector("[data-testid=loader-bar]");
    if (bar && !bar.__seen) {
      bar.__seen = true;
      window.__bars++;
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
};

async function run() {
  await waitPreview();
  const browser = await chromium.launch({ headless: true });
  try {
    console.log("— глобальный лоадер —");
    {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 860 },
      });
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      await page.evaluate(COUNT_BAR);
      assert.equal(
        await page.locator("[data-testid=loader-bar]").count(),
        0,
        "в покое полоски нет",
      );

      const slow = async (route) => {
        await sleep(900);
        await route.continue();
      };
      // Медленные данные И код следующей страницы (у /form нет серверного load).
      await page.route("**/__data.json*", slow);
      await page.route("**/_app/immutable/**", slow);
      await page.locator('a[href="/form"]').first().click();
      const bar = page.locator("[data-testid=loader-bar]");
      await bar.waitFor({ state: "visible", timeout: 2000 });
      assert.equal(await bar.getAttribute("role"), "progressbar");
      assert.equal(
        await bar.getAttribute("aria-valuenow"),
        null,
        "у перехода нет процента",
      );
      ok("медленный переход зажигает полоску без процента");
      await page.waitForURL("**/form");
      await bar.waitFor({ state: "detached", timeout: 3000 });
      ok("полоска гаснет после перехода");
      await page.unroute("**/__data.json*");
      await page.unroute("**/_app/immutable/**");

      // Быстрый переход (без задержки) — полоска не мигает.
      const before = await page.evaluate(() => window.__bars);
      await page.locator('a[href="/"]').first().click();
      await page.waitForURL(BASE + "/");
      await page.waitForLoadState("networkidle");
      await sleep(300);
      assert.equal(
        await page.evaluate(() => window.__bars),
        before,
        "быстрый переход без полоски",
      );
      ok("быстрый переход полоску не зажигает");
      await page.close();
    }
    {
      // Модалка с загрузчиком (/cards/7 грузит данные ~300 мс): полоска — только
      // на время ЕЁ загрузки и с её подписью; «мелкая» запись адреса сама
      // (navigating 1–2 мс) полоску не зажигает.
      const page = await browser.newPage({
        viewport: { width: 1280, height: 860 },
      });
      await page.goto(BASE + "/modals", { waitUntil: "networkidle" });
      await page.evaluate(() => {
        window.__labels = [];
        new MutationObserver(() => {
          const bar = document.querySelector("[data-testid=loader-bar]");
          if (bar) window.__labels.push(bar.getAttribute("aria-label"));
        }).observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
        });
      });
      await page.locator('a[href="/cards/7"][data-modal-link]').first().click();
      await page
        .locator("[role=dialog]")
        .first()
        .waitFor({ state: "visible", timeout: 5000 });
      await sleep(300);
      const labels = [...new Set(await page.evaluate(() => window.__labels))];
      assert.ok(
        labels.every((l) => l === "Загрузка модалки"),
        `подписи полоски: ${labels}`,
      );
      assert.equal(
        await page.locator("[data-testid=loader-bar]").count(),
        0,
        "после открытия полоски нет",
      );
      ok("модалка: полоска только на время её загрузки");
      await page.close();
    }
    {
      // Кнопка с `task={formTask(form.state, intent)}`: спиннер у нажатой, полоска,
      // после ответа всё снято (в том числе `aria-busy`, который ставит и сама форма).
      const page = await browser.newPage({
        viewport: { width: 1280, height: 860 },
      });
      await page.goto(BASE + "/form", { waitUntil: "networkidle" });
      await page.route("**/form/submit", async (route) => {
        await sleep(900);
        await route.continue();
      });
      const draft = page.locator("button[name=intent][value=save-draft]");
      const create = page.locator("button[name=intent][value=submit]");
      await draft.click();
      await sleep(400);
      assert.equal(
        await draft.getAttribute("data-state"),
        "loading",
        "спиннер у нажатой",
      );
      assert.equal(await draft.getAttribute("aria-busy"), "true");
      assert.equal(
        await draft.isDisabled(),
        true,
        "нажатая кнопка disabled, пока идёт отправка",
      );
      assert.equal(
        await create.getAttribute("data-state"),
        null,
        "у второй кнопки спиннера нет",
      );
      assert.equal(
        await page.locator("[data-testid=loader-bar]").count(),
        1,
        "отправка видна в полоске",
      );
      ok("отправка формы: спиннер и disabled у нажатой кнопки, полоска");
      await page.waitForFunction(
        () => !document.querySelector("[data-testid=loader-bar]"),
        null,
        { timeout: 5000 },
      );
      await sleep(100);
      assert.equal(await draft.getAttribute("data-state"), null);
      assert.equal(
        await draft.getAttribute("aria-busy"),
        null,
        "aria-busy снят",
      );
      assert.equal(await draft.isDisabled(), false, "disabled снят");
      ok("после ответа состояние снято");
      await page.close();
    }
    {
      // Пагинатор (демо-источник с задержкой): спиннер у того, кто запустил загрузку.
      const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
      });
      await page.goto(BASE + "/paginator", { waitUntil: "networkidle" });
      await page.evaluate(() => {
        window.__seen = [];
        new MutationObserver((ms) => {
          for (const m of ms) {
            const el = m.target;
            if (el.getAttribute("data-state") !== "loading") continue;
            const spinner = el.parentElement?.querySelector(
              "[data-task-spinner]",
            );
            window.__seen.push({
              tag: el.tagName,
              text: (el.textContent || "").trim().slice(0, 20),
              busy: el.getAttribute("aria-busy"),
              spinner: spinner ? getComputedStyle(spinner).display : null,
              bar: Boolean(document.querySelector("[data-testid=loader-bar]")),
            });
          }
        }).observe(document.body, {
          attributes: true,
          subtree: true,
          attributeFilter: ["data-state"],
        });
      });
      const seen = async (tag) => {
        await page.waitForFunction(
          (t) => window.__seen.some((s) => s.tag === t),
          tag,
          { timeout: 5000 },
        );
        await page.waitForFunction(
          () => !document.querySelector("[data-state=loading]"),
          null,
          { timeout: 8000 },
        );
        return (await page.evaluate(() => window.__seen.splice(0))).find(
          (s) => s.tag === tag,
        );
      };

      // Ссылка на страницу 2 — в листе страниц спиннер по умолчанию отключён
      // (не мигает ни при клике, ни при фоновой подгрузке ленты во время скролла).
      await page
        .locator('a[data-link]', { hasText: /^\s*2\s*$/ })
        .first()
        .click();
      await page.waitForFunction(
        () => new URL(location.href).searchParams.get("page") === "2",
        null,
        { timeout: 5000 },
      );
      const pageLinkSpins = await page.evaluate(() =>
        window.__seen.splice(0).filter((s) => s.tag === "SPAN" || s.text === "2"),
      );
      assert.equal(
        pageLinkSpins.length,
        0,
        "у номеров страниц в PageNav спиннер отключён",
      );
      ok("страница пагинатора: у листа страниц спиннер отключён");

      await page.locator("input[type=search]").click();
      await page.keyboard.type("nar", { delay: 30 });
      const input = await seen("INPUT");
      assert.equal(input.spinner, "flex", "спиннер в поле поиска виден");
      assert.equal(input.busy, "true");
      ok("поиск: спиннер в поле на время выдачи, затем снят");

      // У URL-адаптера «Сброс» — ссылка (работает без JS); спиннер тот же.
      await page.getByRole("link", { name: "Сброс" }).click();
      const reset = await seen("A");
      assert.equal(reset.text, "Сброс");
      ok("«Сброс»: спиннер у ссылки на время загрузки, затем снят");
      await page.close();
    }
    {
      // Ход сервера строками (src/lib/task/README.md). Холодный запуск базы
      // локально не повторить (страница уже открыла её на сервере), поэтому сервер
      // «ждёт» в браузере: `fetch` с запросом строк получает поток — четыре строки хода
      // с паузой, затем настоящий ответ последней строкой. Дальше путь настоящий:
      // `fetchWithTask` → `readTaskStream` → состояние списка/формы → ссылка, кнопка, полоса.
      const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
      });
      await page.addInitScript(() => {
        const real = window.fetch.bind(window);
        window.fetch = async (input, init = {}) => {
          const url = String(input instanceof Request ? input.url : input);
          const accept = new Headers(init.headers).get("accept") ?? "";
          // Только после включения тестом: загрузки при гидрации идут как есть.
          if (
            !window.__slow ||
            !accept.includes("x-ndjson") ||
            !/\/api\/db-posts|\/db-demo\/submit/.test(url)
          )
            return real(input, init);
          const enc = new TextEncoder();
          const line = (v) => enc.encode(JSON.stringify(v) + "\n");
          const stream = new ReadableStream({
            async start(c) {
              const steps = [
                "Подключение",
                "Проверка схемы",
                "Таблица demo_post",
                "Скрипт demo-post-seed-500",
              ];
              for (let done = 0; done < 4; done++) {
                c.enqueue(
                  line({
                    task: {
                      status: "pending",
                      scope: "global",
                      label: "Запуск базы",
                      progress: {
                        kind: "steps",
                        done,
                        total: 4,
                        step: steps[done],
                      },
                    },
                  }),
                );
                await new Promise((r) => setTimeout(r, 350));
              }
              const res = await real(input, {
                ...init,
                headers: { accept: "application/json" },
              });
              const headers = Object.fromEntries(res.headers);
              c.enqueue(
                line({
                  result: {
                    status: res.status,
                    headers,
                    body: await res.json(),
                  },
                }),
              );
              c.close();
            },
          });
          return new Response(stream, {
            headers: { "content-type": "application/x-ndjson; charset=utf-8" },
          });
        };
      });
      await page.goto(BASE + "/db-demo", { waitUntil: "networkidle" });
      await page.evaluate(() => {
        window.__slow = true;
        window.__seen = [];
        const snap = () => {
          const bar = document.querySelector("[data-testid=loader-bar]");
          const el = document.querySelector("[data-task-percent]");
          const s = {
            bar: bar ? bar.getAttribute("aria-label") : null,
            now: bar ? bar.getAttribute("aria-valuenow") : null,
            tag: el ? el.tagName : null,
            text: el ? (el.textContent || "").trim().slice(0, 12) : null,
            percent: el ? el.getAttribute("data-task-percent") : null,
          };
          if (JSON.stringify(window.__seen.at(-1)) !== JSON.stringify(s))
            window.__seen.push(s);
        };
        new MutationObserver(snap).observe(document.body, {
          attributes: true,
          childList: true,
          subtree: true,
        });
      });
      const settle = async () => {
        await page.waitForFunction(
          () => window.__seen.some((s) => s.bar?.startsWith("Запуск базы")),
          null,
          { timeout: 5000 },
        );
        await page.waitForFunction(
          () => !document.querySelector("[data-testid=loader-bar]"),
          null,
          { timeout: 10000 },
        );
        return page.evaluate(() => window.__seen.splice(0));
      };

      // Клик без наведения: иначе страницу 2 заранее подгрузит prefetch (без хода) и
      // переход будет мгновенным.
      await page
        .locator('a[data-link]', { hasText: /^\s*2\s*$/ })
        .first()
        .evaluate((a) => a.click());
      let log = await settle();
      const bars = [...new Set(log.map((s) => s.bar).filter(Boolean))];
      assert.ok(
        bars.includes("Запуск базы — шаг 2 из 4: Проверка схемы"),
        JSON.stringify(bars),
      );
      const indicatorPercents = log
        .filter((s) => s.tag === "DIV" && s.percent !== null)
        .map((s) => Number(s.percent));
      assert.ok(
        indicatorPercents.length >= 2 &&
          indicatorPercents.at(-1) > indicatorPercents[0],
        `процент у родного индикатора пагинатора растёт: ${indicatorPercents}`,
      );
      assert.equal(
        await page.locator("[data-task-percent]").count(),
        0,
        "после ответа процент снят",
      );
      ok(
        `ход сервера у списка: полоса «${bars[1]}», процент родного индикатора ${indicatorPercents.join("→")}`,
      );

      await page.fill('input[name="title"]', `ход-${Date.now() % 100000}`);
      await page.check('input[name="agree"]');
      await page.locator("[data-testid=create]").click();
      log = await settle();
      const buttonPercents = log
        .filter((s) => s.tag === "BUTTON")
        .map((s) => Number(s.percent));
      assert.ok(
        buttonPercents.length >= 2 && buttonPercents.at(-1) > buttonPercents[0],
        `процент на кнопке растёт: ${buttonPercents}`,
      );
      await page.waitForFunction(
        () =>
          document
            .querySelector("[data-testid=create]")
            ?.getAttribute("aria-busy") === null,
        null,
        { timeout: 5000 },
      );
      ok(
        `ход сервера при отправке формы: процент на кнопке ${buttonPercents.join("→")}, затем снят`,
      );
      await page.close();
    }
    {
      const ctx = await browser.newContext({ javaScriptEnabled: false });
      const page = await ctx.newPage();
      await page.goto(BASE + "/", { waitUntil: "load" });
      assert.equal(await page.locator("[data-testid=loader-bar]").count(), 0);
      ok("без JS полоски нет");
      await ctx.close();
    }
    console.log(`✅ loader: ${passed} проверок прошли`);
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error("❌ loader:", e);
  process.exit(1);
});
