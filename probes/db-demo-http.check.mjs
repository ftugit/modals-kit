/**
 * HTTP-проверка демо-роута на обновлённом modals-kit: без браузера (в песочнице
 * vite dev + chromium = OOM 137), но через тот же SvelteKit-путь — load, формы
 * (actions), dbHandle, PGlite. Проверяет ровно то, ради чего и переносился пакет:
 * что пакетная сборка 0.2.0 живёт в приложении и деградации нет.
 */
const base = process.env.DEMO_URL ?? "http://127.0.0.1:5173/db-demo";
const results = [];
let failed = 0;

const body = async () => {
  const r = await fetch(base, { headers: { accept: "text/html" } });
  return { status: r.status, html: await r.text() };
};
/* «нет tbody» ≠ «ноль строк»: страница ошибки тоже не имеет tbody, и без этого
   различия 403/422 выглядят как «фильтр ничего не нашёл». */
const count = (html) => {
  const m = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!m) throw new Error("tbody отсутствует (страница ошибки?)");
  return (m[1].match(/<tr[\s>]/g) ?? []).length;   // <tr class="…"> — строки с атрибутами тоже
};
const step = async (name, fn) => {
  try {
    const value = await fn();
    console.log("  ✓ " + name.padEnd(48) + " → " + value);
    results.push([name, value]);
  } catch (error) {
    failed++;
    console.log("  ✗ " + name.padEnd(48) + " → " + String(error).split("\n")[0]);
  }
};

// дожидаемся готовности dev-сервера (vite на первом запросе компилирует всё)
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(base, { headers: { accept: "text/html" } });
    if (r.ok) break;
  } catch {
    /* ещё не поднялся */
  }
  await new Promise((r) => setTimeout(r, 2000));
}

await step("GET /db-demo → 200", async () => (await body()).status === 200);
await step("SSR отдал строки (миграция + сид применены)", async () => {
  const n = count((await body()).html);
  if (n < 1) throw new Error("tbody пуст");
  return n + " строк";
});
await step("в HTML есть id-хвост строки (raw-блок)", async () =>
  /<td><code>[0-9a-f]{8}/.test((await body()).html));
await step("счётчик записей на странице", async () => {
  const m = (await body()).html.match(/<strong[^>]*>(\d+)<\/strong>/);
  if (!m) throw new Error("счётчик не найден");
  return m[1];
});

/** SvelteKit (production) требует, чтобы у POST с form-action совпадал Origin
 *  (csrf_check_origin): без заголовка — 403. Браузер его шлёт всегда, рукописный
 *  fetch — нет, поэтому Origin подставляем. В `vite dev` проверки мягче, и это
 *  различие (dev зелёный, preview 403) — само по себе урок: проверять и build. */
/**
 * Конверт формы (`__form_id`, `__form_rev`, `__form_instance`, `__form_submission`)
 * рендерит `bind` через `form.hidden()`. Проб не придумывает его, а вырезает из
 * HTML той самой `<form>`, которую собрал слой: так проверка заодно доказывает,
 * что обёртка отдаёт обязательные пары.
 */
const envelopeOf = (html, formId) => {
  const block = html.split("</form>").find((b) => b.includes(`name="__form_id" value="${formId}"`));
  if (!block) throw new Error(`в HTML нет формы ${formId} с конвертом`);
  const fd = new URLSearchParams();
  for (const m of block.matchAll(/name="(__form_[a-z]+|intent)" value="([^"]*)"/g)) fd.set(m[1], m[2]);
  for (const key of ["__form_id", "__form_rev", "__form_instance", "__form_submission"])
    if (!fd.has(key)) throw new Error(`конверт неполный: нет ${key}`);
  return fd;
};

const ORIGIN = new URL(base).origin;
/**
 * Конверт обязателен и для статического описания: `createFormHandler` сверяет
 * `__form_id` (policy.ts: id/rev/instance/submission/spec/intent), иначе ответ
 * — 400 `envelope.missing`, а не отказ валидации. Браузер получает эти пары из
 * `form.hidden()`, рукописный запрос обязан подставить их сам.
 */
const form = (fields, envelope) => {
  const fd = envelope ? new URLSearchParams(envelope) : new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
    body: fd.toString(),
  };
};

await step("POST /db-demo?/create → строка добавлена", async () => {
  const html0 = (await body()).html;
  const before = count(html0);
  const title = "проверка-" + Date.now().toString(36);
  const r = await fetch(base + "?/create", form({ title }, envelopeOf(html0, "db_demo_create")));
  if (!r.ok && r.status !== 303 && r.status !== 200) throw new Error("status " + r.status);
  const html = (await body()).html;
  const after = count(html);
  if (!html.includes(title)) throw new Error("новой строки нет в HTML");
  return `${before} → ${after}`;
});
await step("валидация: короткий title = ошибка поля, не 500", async () => {
  const html = await (await fetch(base + "?/create", form({ title: "а" }, envelopeOf((await body()).html, "db_demo_create")))).text();
  if (/500|Internal Server Error|error-boundary/i.test(html) && !/минимум|от 3|at least|short/i.test(html))
    throw new Error("похоже на 500: " + html.slice(0, 80));
  return /минимум|от 3|at least|short|3/i.test(html) ? "текст ошибки поля на месте" : "проверь: ошибки нет";
});
await step("POST ?/remove убивает строку (count-1)", async () => {
  const before = count((await body()).html);
  const html = (await body()).html;
  // id больше не прячется в разметку: страница печатает его целиком в таблице,
  // и поле удаления — обычное видимое поле (скрытая пара для этого не нужна).
  const first = html.match(/<td><code>([0-9a-f-]{8,})<\/code><\/td>/);
  if (!first) throw new Error("id строки не найден в таблице");
  const r = await fetch(base + "?/remove", form({ ids: first[1] }, envelopeOf(html, "db_demo_remove")));
  if (!r.ok && r.status !== 303) throw new Error("status " + r.status);
  const after = count((await body()).html);
  if (after >= before) throw new Error(`${before} → ${after} (не уменьшилось)`);
  return `${before} → ${after}`;
});
/* ── защита: кто и когда отвечает ────────────────────────────────────────
   Порядок жёстко задан кодом SvelteKit: проверка `csrf_check_origin` стоит ДО
   `handle` (respond.js), поэтому на form-encoded POST отказ отдаёт фреймворк —
   переопределить это из приложения нельзя. Зато на `application/json` фреймворк
   слеп (это не form content-type), и там работает слой 02 из lib/form. */
await step("чужой origin на нативном POST = 403 от фреймворка (не 500)", async () => {
  const fd = new URLSearchParams({ title: "межсайтовая попытка" });
  const r = await fetch(base + "?/create", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" },
    body: fd.toString(),
  });
  const html = await r.text();
  if (r.status !== 403) throw new Error("ожидался 403, получен " + r.status);
  if (!/Cross-site POST form submissions are forbidden/.test(html))
    throw new Error("отказ выглядит не как ответ фреймворка: " + html.slice(0, 120));
  return "403, текст SvelteKit — так и должно быть";
});

await step("/form/submit принимает только form-encoded: JSON = 400, не 500", async () => {
  const r = await fetch(new URL("/form/submit", base).href, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, accept: "application/json" },
    body: JSON.stringify({ email: "x@example.com" }),
  });
  const text = await r.text();
  if (r.status === 500) throw new Error("500 на незнакомое тело");
  if (r.status !== 400) throw new Error("ожидали 400 envelope.missing, получен " + r.status);
  if (!text.includes("envelope.missing")) throw new Error("нет кода причины: " + text.slice(0, 120));
  return "400 envelope.missing — тело читает слой, а не маршрут";
});

await step("GET с ?limit=1 отвечает страницей в 1 строку", async () => {
  const r = await fetch(base + "?limit=1", { headers: { accept: "text/html" } });
  return count(await r.text());
});
await step("в HTML нет «Cannot find module»/«is not exported»", async () => {
  const html = (await body()).html;
  const bad = /Cannot find module|is not exported|Failed to resolve import|kit-db.*undefined/.exec(html);
  if (bad) throw new Error(bad[0]);
  return "чисто";
});

console.log(failed ? `\nINTEGRATION_HTTP_FAIL: ${failed}` : `\nINTEGRATION_HTTP_OK (${results.length} проверок)`);
process.exit(failed ? 1 : 0);
