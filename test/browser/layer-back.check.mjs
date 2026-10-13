/**
 * Системный «Назад»/«Вперёд» и адрес страницы под слоем (ход 106, F59).
 *
 * Слой — мобильная панель (drawer) на узком экране: своя запись истории
 * (`shallowFlag`). Пока она открыта, настройку пагинатора меняют под ней (адрес
 * ложится в запись слоя), а закрывают слой системной кнопкой — обходом
 * истории, а не самим приложением. Без связок слоёв (`layer-links.ts`)
 * изменение пропадало. (Список селекта для этого не годится: при смене адреса
 * под ним он закрывается сам своим шагом назад — это случай F59, его проверяет
 * `paginate.mjs`.)
 *
 *  A. «Назад» закрывает слой и сохраняет изменение, сделанное под ним.
 *  B. «Вперёд» в слой не возвращает устаревшие настройки страницы.
 *  C. После перезагрузки на записи слоя связка жива (sessionStorage).
 *
 * Движки: Chromium, Firefox, WebKit (BROWSERS=chromium,firefox,webkit).
 * Запуск: LAYER_BACK_BASE=http://127.0.0.1:4173 node test/browser/layer-back.check.mjs
 */
import { chromium, firefox, webkit } from "playwright";

const BASE =
  process.env.LAYER_BACK_BASE ??
  `http://127.0.0.1:${process.env.MODALS_PORT ?? 4173}`;
const ENGINES = { chromium, firefox, webkit };
const wanted = (process.env.BROWSERS ?? "chromium,firefox,webkit")
  .split(",")
  .map((s) => s.trim());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let checks = 0;
const ok = (name, msg) => {
  checks++;
  console.log(`  ok  ${name}: ${msg}`);
};

async function run(name, type) {
  const browser = await type.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      viewport: { width: 700, height: 900 },
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    const sel = (n) =>
      page.locator(`[data-testid="demo-panel"] select[name="${n}"]`);
    const params = () => new URL(page.url()).searchParams;
    const layerOpen = () => page.locator("#fe-sidebar").isChecked();
    const openLayer = async () => {
      await page.locator('label[for="fe-sidebar"]:visible').first().click();
      await sleep(600);
      if (!(await layerOpen()))
        throw new Error(`${name}: мобильная панель не открылась`);
    };
    // Смена настройки под открытым слоем: события без фокуса и кликов — слой
    // не должен закрыться сам (иначе это свой шаг назад, не системный).
    const changeUnder = async (n, value) => {
      await sel(n).evaluate((el, v) => {
        el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, value);
      await sleep(1500);
    };

    await page.goto(`${BASE}/paginator`, { waitUntil: "networkidle" });
    await sleep(800);
    if (!(await page.evaluate(() => "navigation" in window)))
      throw new Error(
        `${name}: нет Navigation API — проверка не о том браузере`,
      );

    // A
    await openLayer();
    await changeUnder("page.size", "10");
    if (!(await layerOpen()))
      throw new Error(
        `${name} A: слой закрылся сам — сценарий не о системном «Назад»`,
      );
    if (params().get("page.size") !== "10")
      throw new Error(`${name} A: под слоем адрес не записался: ${page.url()}`);
    await page.goBack();
    await sleep(1500);
    if (await layerOpen()) throw new Error(`${name} A: «Назад» не закрыл слой`);
    if (
      params().get("page.size") !== "10" ||
      (await sel("page.size").inputValue()) !== "10"
    )
      throw new Error(
        `${name} A: изменение под слоем пропало после «Назад»: ${page.url()} size=${await sel("page.size").inputValue()}`,
      );
    ok(name, "A «Назад» закрыл слой, изменение под ним сохранилось");

    // B
    await changeUnder("page.src", "photos");
    if (params().get("page.src") !== "photos")
      throw new Error(
        `${name} B: смена источника не записалась: ${page.url()}`,
      );
    await page.goForward();
    await sleep(1500);
    if (
      params().get("page.src") !== "photos" ||
      params().get("page.size") !== "10"
    )
      throw new Error(
        `${name} B: «Вперёд» в слой вернул устаревший адрес: ${page.url()}`,
      );
    if ((await sel("page.src").inputValue()) !== "photos")
      throw new Error(
        `${name} B: «Вперёд» откатил источник: ${await sel("page.src").inputValue()}`,
      );
    await page.goBack();
    await sleep(1500);
    if (
      params().get("page.src") !== "photos" ||
      params().get("page.size") !== "10"
    )
      throw new Error(
        `${name} B: после «Вперёд»/«Назад» адрес потерян: ${page.url()}`,
      );
    ok(
      name,
      "B «Вперёд» в слой не вернул устаревшие настройки; «Назад» снова сохранил их",
    );

    // C
    await page.goto(`${BASE}/paginator`, { waitUntil: "networkidle" });
    await sleep(800);
    await openLayer();
    await page.reload({ waitUntil: "networkidle" });
    await sleep(1000);
    await changeUnder("page.size", "5");
    if (params().get("page.size") !== "5")
      throw new Error(
        `${name} C: после перезагрузки адрес не записался: ${page.url()}`,
      );
    await page.goBack();
    await sleep(1500);
    if (params().get("page.size") !== "5")
      throw new Error(
        `${name} C: после перезагрузки на записи слоя «Назад» потерял изменение: ${page.url()}`,
      );
    ok(name, "C связка пережила перезагрузку на записи слоя");

    if (errors.length)
      throw new Error(`${name}: ошибки страницы: ${errors.join(" | ")}`);
    await ctx.close();
  } finally {
    await browser.close();
  }
}

for (const name of wanted) {
  const type = ENGINES[name];
  if (!type) throw new Error(`неизвестный движок ${name}`);
  await run(name, type);
}
console.log(`\nLAYER_BACK_OK (${checks} проверок: ${wanted.join(", ")})`);
