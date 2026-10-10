/**
 * HTTP-проверка демо-роута на обновлённом modals-kit: без браузера (в песочнице
 * vite dev + chromium = OOM 137), но через тот же SvelteKit-путь — load, формы
 * (actions), dbHandle, PGlite. Проверяет ровно то, ради чего и переносился пакет:
 * что пакетная сборка 0.2.0 живёт в приложении и деградации нет.
 */
const base = process.env.DEMO_URL ?? "http://127.0.0.1:5173/db-demo";
const results = [];
/* Каноническая форма фильтра слоя: {op, field, value} — её разбирает
   `parseListInput`, а не выдуманный пробом вариант. */
const FILTER_EQ_3 = { op: "eq", field: "title", value: "Запись 3" };
let failed = 0;

const body = async () => {
  const r = await fetch(base, { headers: { accept: "text/html" } });
  return { status: r.status, html: await r.text() };
};
/* Список рисует PageList пагинатора, поэтому строки считаются по метке
   `data-testid="row"`. «Нет контейнера» ≠ «ноль строк»: страница ошибки тоже
   пустая, и без этого различия 400/403 выглядят как «фильтр ничего не нашёл». */
const count = (html) => {
  if (!/data-testid="rows"/.test(html)) throw new Error("контейнер списка отсутствует (страница ошибки?)");
  return (html.match(/data-testid="row"/g) ?? []).length;
};
/** Id показанных строк — по ним видно, что вторая страница действительно другая. */
const ids = (html) => [...html.matchAll(/data-testid="row-id">([0-9a-f-]{8,})</g)].map((m) => m[1]);
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
await step("в HTML есть id строки целиком (его копируют в поле удаления)", async () =>
  ids((await body()).html).length > 0);
const totalOf = (html) => {
  const m = html.match(/data-testid="total"[^>]*>(\d+)</);
  if (!m) throw new Error("счётчик записей не найден");
  return Number(m[1]);
};
await step("счётчик записей на странице", async () => String(totalOf((await body()).html)));

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
 * Тот же конвейер, что и у страницы, но без HTML: ответы источника. Проверять
 * «страницы» и «курсор» одним браузерным текстом нельзя — на уровне ответа видно
 * то, чего разметка уже не скроет: `totalItems` в keyset-режиме, порядок id.
 */
const API = ORIGIN + "/api/db-posts";
const APP = ORIGIN + "/paginator";
const api = async (query) => {
  const r = await fetch(API + "?" + query, { headers: { accept: "application/json" } });
  return { status: r.status, body: await r.json().catch(() => null) };
};
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

/* Первая страница всегда умещается в размер, поэтому «строк стало больше» под
   пагинацией ничего не доказывает: проверяется total и то, что новая запись
   попала в первую страницу (порядок — created_at DESC). */
await step("POST /db-demo?/create → запись в начале списка, total +1", async () => {
  const html0 = (await body()).html;
  const before = totalOf(html0);
  const title = "проверка-" + Date.now().toString(36);
  const r = await fetch(base + "?/create", form({ title }, envelopeOf(html0, "db_demo_create")));
  if (!r.ok && r.status !== 303 && r.status !== 200) throw new Error("status " + r.status);
  const html = (await body()).html;
  if (!html.includes(title)) throw new Error("новой строки нет в HTML");
  const after = totalOf(html);
  if (after !== before + 1) throw new Error(`total ${before} → ${after}`);
  return `total ${before} → ${after}, строка первая в списке`;
});
await step("валидация: короткий title = ошибка поля, не 500", async () => {
  const html = await (await fetch(base + "?/create", form({ title: "а" }, envelopeOf((await body()).html, "db_demo_create")))).text();
  if (/500|Internal Server Error|error-boundary/i.test(html) && !/минимум|от 3|at least|short/i.test(html))
    throw new Error("похоже на 500: " + html.slice(0, 80));
  return /минимум|от 3|at least|short|3/i.test(html) ? "текст ошибки поля на месте" : "проверь: ошибки нет";
});
await step("POST ?/remove убивает строку (total -1, id исчез)", async () => {
  const html = (await body()).html;
  const before = totalOf(html);
  // id больше не прячется в разметку: страница печатает его целиком в таблице,
  // и поле удаления — обычное видимое поле (скрытая пара для этого не нужна).
  const [first] = ids(html);
  if (!first) throw new Error("id строки не найден в списке");
  const r = await fetch(base + "?/remove", form({ ids: first }, envelopeOf(html, "db_demo_remove")));
  if (!r.ok && r.status !== 303) throw new Error("status " + r.status);
  const html1 = (await body()).html;
  const after = totalOf(html1);
  if (after !== before - 1) throw new Error(`total ${before} → ${after}`);
  if (ids(html1).includes(first)) throw new Error("удалённый id всё ещё в списке");
  return `total ${before} → ${after}, id ${first.slice(0, 8)}… исчез`;
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

/* Ключи адреса принадлежат пагинатору и они общие для приложения: ?page,
   ?page.size, ?page.flt, ?page.ord. Прежний ?limit был ключом слоя и в демо
   больше не работает; своего имени параметра (`?db`) список не требует. */
await step("GET с ?page.size=3 отвечает страницей в 3 строки", async () => {
  const r = await fetch(base + "?page.size=3", { headers: { accept: "text/html" } });
  const n = count(await r.text());
  if (n !== 3) throw new Error(`${n} строк вместо 3`);
  return "3";
});
await step("вне разрешённых ?page.size откатывается на размер пагинатора", async () => {
  const r = await fetch(base + "?page.size=1", { headers: { accept: "text/html" } });
  const n = count(await r.text());
  if (n !== 5) throw new Error(`${n} строк — deny-safe не сработал`);
  return "5 (default)";
});
await step("?page=2 отдаёт ДРУГИЕ строки (SSR-снапшот читает адрес)", async () => {
  const a = ids((await body()).html);
  const r = await fetch(base + "?page=2", { headers: { accept: "text/html" } });
  const b = ids(await r.text());
  if (!b.length) throw new Error("вторая страница пуста");
  if (a.join() === b.join()) throw new Error("?page=2 вернул те же id");
  return `${a.length} → ${b.length} строк, id не пересекаются`;
});
await step("GET /api/db-posts отвечает конвертом пагинатора", async () => {
  const r = await fetch(new URL("/api/db-posts?page=1&size=2", base).href);
  const j = await r.json();
  if (!Array.isArray(j.items) || typeof j.totalItems !== "number")
    throw new Error(JSON.stringify(j).slice(0, 120));
  return `${j.items.length} из ${j.totalItems}, hasNext=${j.hasNext}`;
});
/* `/api/db-posts` принимает фиксированный набор ключей (page/size/flt/ord), а
   разбор внутри — `parseListInput`, который и отвечает deny-safe: неизвестное
   поле фильтра отбивается с кодом, а не молча просачивается в SQL. */
await step("неизвестное поле в фильтре = 4xx с кодом, не 500", async () => {
  const r = await fetch(new URL('/api/db-posts?page=1&flt=' + encodeURIComponent('{"nope":1}'), base).href);
  const text = await r.text();
  if (r.status < 400 || r.status >= 500) throw new Error(`status ${r.status}: ${text.slice(0, 80)}`);
  const code = JSON.parse(text).code ?? "?";
  return `${r.status} ${code}`;
});
/* Битый фильтр — не 500 и не «пусто»: пагинатор переводит отказ источника в
   своё состояние error, и страница остаётся страницей (ErrorRow с причиной и
   «Повторить»). Тот же отказ на эндпоинте обязан прийти 4xx с кодом. */
/* Перехваченный путь: транспорт `lib/form` шлёт fetch на /db-demo/submit и
   получает Result. Это проверка того, что страница после отправки НЕ
   перечитывается: ответ — JSON формы, а не новый HTML, и приём при этом общий
   с `?/create` (тот же `createFormHandler`). */
await step("POST /db-demo/submit (транспорт) = Result JSON, запись видна в списке", async () => {
  const html0 = (await body()).html;
  const params = envelopeOf(html0, "db_demo_create");
  const title = "fetch-" + Date.now().toString(36);
  params.set("title", title);
  const r = await fetch(new URL("/db-demo/submit", base).href, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, accept: "application/json" },
    body: params.toString(),
  });
  const type = r.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) throw new Error(`ответ не JSON (${type}): значит это HTML страницы`);
  const result = await r.json();
  if (result.ok !== true) throw new Error(`ok=${result.ok} status=${r.status}: ${JSON.stringify(result.errors ?? result).slice(0, 160)}`);
  const html = (await body()).html;
  if (!html.includes(title)) throw new Error("запись создана, но её нет в списке");
  return `${r.status} ok, outcome=${result.outcome}, строка в списке`;
});
await step("POST /db-demo/submit без конверта = отказ слоя, не 500 и не HTML", async () => {
  const r = await fetch(new URL("/db-demo/submit", base).href, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, accept: "application/json" },
    body: new URLSearchParams({ title: "без конверта", __form_id: "db_demo_create" }).toString(),
  });
  const type = r.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) throw new Error(`не-JSON ответ ${r.status}`);
  const result = await r.json();
  if (result.ok === true) throw new Error("пустой конверт принят");
  const code = (result.errors ?? [{}])[0]?.code ?? "?";
  if (r.status === 500) throw new Error("500 вместо отказа валидации");
  return `${r.status}, code=${code}`;
});
/* Режим навигации — тоже ключ адреса, значит работает и без JavaScript: SSR
   обязан отдать ручную ссылку «показать ещё» с токеном вместо списка номеров.
   Указатель выдаёт сервер, поэтому в разметке он есть уже на первой отрисовке. */
await step("?page.cur=1 без JS отдаёт ссылку подгрузки с токеном (не PageNav)", async () => {
  const r = await fetch(base + "?page.cur=1&page.size=3", { headers: { accept: "text/html" } });
  const html = await r.text();
  // Ссылка «дальше» и её токен — один тег, причём `href` идёт первым (атрибуты
  // в SSR-разметке не упорядочены нашей волей), поэтому ищем пары, а не порядок.
  const link = /<a [^>]*href="([^"]*page\.after=([^&#"]+)[^"]*)"[^>]*data-testid="load-next"/.exec(html);
  if (!link) throw new Error("ссылки подгрузки с токеном в SSR-разметке нет");
  const token = decodeURIComponent(link[2]);
  if (html.includes('data-testid="page-nav"')) throw new Error("в курсорном режиме остался список номеров страниц");
  return "load-next с токеном " + token.slice(0, 12) + "…, PageNav нет";
});
await step("?page.cur=on (чекбокс нативного GET) = ?page.cur=1 (панель)", async () => {
  // Без JavaScript флаг приезжает как `on` (см. `builtins.ts` формы), панель пишет
  // boolean. Значения разные, смысл обязан быть один: те же строки на экране.
  const one = await (await fetch(base + "?page.cur=1&page.size=3", { headers: { accept: "text/html" } })).text();
  const on = await (await fetch(base + "?page.cur=on&page.size=3", { headers: { accept: "text/html" } })).text();
  if (ids(one).join() !== ids(on).join()) throw new Error("строки разошлись: " + ids(one)[0] + " / " + ids(on)[0]);
  if (!/page\.after=/.test(on)) throw new Error("`on` не включает курсорный режим: токена в ссылках нет");
  return ids(one).length + " одинаковых строк, токен в ссылках есть там и там";
});
await step("битый JSON в ?page.flt = ErrorRow с причиной (не 500, не пусто)", async () => {
  const r = await fetch(base + "?page.flt=" + encodeURIComponent("{title:"), { headers: { accept: "text/html" } });
  const html = await r.text();
  if (/Internal Server Error|error-boundary/i.test(html)) throw new Error("похоже на 500: " + html.slice(0, 80));
  if (!/data-testid="error-row"/.test(html)) throw new Error(`отказа в списке нет, status ${r.status}`);
  if (count(html) !== 0) throw new Error("строки показаны несмотря на битый фильтр");
  return `status ${r.status}, строка отказа на месте`;
});
await step("?page.flt=<фильтр слоя> сужает список и total", async () => {
  const r = await fetch(base + "?page.flt=" + encodeURIComponent(JSON.stringify(FILTER_EQ_3)), {
    headers: { accept: "text/html" },
  });
  const html = await r.text();
  if (count(html) !== 1) throw new Error(`${count(html)} строк вместо 1`);
  if (totalOf(html) !== 1) throw new Error(`total ${totalOf(html)} — посчитан без фильтра`);
  if (!html.includes("Запись 3")) throw new Error("нужной строки нет");
  return "1 строка, total 1";
});
await step('?page.ord=[["title","asc"]] меняет порядок (порядок идёт в слой)', async () => {
  const desc = ids((await body()).html);
  const r = await fetch(base + "?page.ord=" + encodeURIComponent(JSON.stringify([["title", "asc"]])), {
    headers: { accept: "text/html" },
  });
  const html = await r.text();
  const asc = ids(html);
  if (!asc.length) throw new Error("строк нет (адрес отброшен?)");
  if (asc.join() === desc.join()) throw new Error("порядок не изменился");
  // Никаких ожиданий по тексту: в живой таблице демо лежат записи прошлых
  // прогонов. Проверяется свойство порядка, а не конкретная запись.
  if (new Set(asc).size !== asc.length) throw new Error("id повторяются в выдаче");
  return `${asc.length} строк, первая — «${(html.match(/data-testid="row"[\s\S]{0,400}?>\s*([^<]{1,40})</) ?? [, "—"])[1].trim()}»`;
});
await step("?page.ord asc = обратный к ?page.ord desc (одна полная страница)", async () => {
  const at = async (dir) => {
    const r = await fetch(base + `?page.size=20&page.ord=${encodeURIComponent(JSON.stringify([["title", dir]]))}`, {
      headers: { accept: "text/html" },
    });
    const html = await r.text();
    if (/data-testid="error-row"/.test(html)) throw new Error(`отказ при order ${dir}: ` + html.slice(0, 120));
    return ids(html);
  };
  const asc = await at("asc");
  const desc = await at("desc");
  if (asc.length < 2) throw new Error(`мало строк для сравнения: ${asc.length}`);
  if (asc.length !== desc.length || desc.join() !== [...asc].reverse().join())
    throw new Error(`asc(${asc.length}) и desc(${desc.length}) — не зеркало: ${asc.join().slice(0, 40)} / ${desc.join().slice(0, 40)}`);
  return `${asc.length} строк в двух направлениях`;
});
await step("мусор в ?page.ord не просачивается (ErrorRow, не 500)", async () => {
  const r = await fetch(base + "?page.ord=" + encodeURIComponent("title:asc"), { headers: { accept: "text/html" } });
  const html = await r.text();
  // Неподходящая ФОРМА ключа отсекает пагинатор (deny-safe) — страница живая.
  if (/Internal Server Error|error-boundary/i.test(html)) throw new Error("похоже на 500: " + html.slice(0, 80));
  return `status ${r.status}, ${(await count(html))} строк default-порядка`;
});
/* ─── ответы источника (не разметка): то, что страница уже не скроет ─── */
await step("API: ?size=3 — ровно 3 строки (дефолт не подменяет запрос)", async () => {
  const { status, body } = await api("size=3&page=1");
  if (status !== 200) throw new Error(`status ${status}`);
  if (body?.items?.length !== 3) throw new Error(`${body?.items?.length} items вместо 3`);
  return `3 из ${body.totalItems}`;
});
await step("API: первый шаг курсора без токена = keyset без total, указатель выдан", async () => {
  const { body } = await api("size=3&cur=1");
  const token = body?.extra?.after;
  if (!token) throw new Error("указателя следующего шага нет: " + JSON.stringify(body?.extra));
  if ("totalItems" in (body ?? {})) throw new Error("totalItems вернулся в keyset-ответе");
  if (body.items.length !== 3) throw new Error(`${body.items.length} items вместо 3`);
  return `токен ${token.slice(0, 10)}…, 3 строки, total нет`;
});
await step("API: цепочка курсора покрывает список без повторов и пропусков", async () => {
  const size = 4;
  const total = (await api(`size=${size}&page=1`)).body.totalItems;
  const seen = [];
  let after = null;
  let steps = 0;
  for (;;) {
    const q = after ? `size=${size}&cur=1&after=${encodeURIComponent(after)}` : `size=${size}&cur=1`;
    const { status, body } = await api(q);
    if (status !== 200) throw new Error(`шаг ${steps + 1}: status ${status} ${JSON.stringify(body).slice(0, 120)}`);
    seen.push(...body.items.map((i) => i.id));
    steps++;
    after = body.hasNext ? body.extra?.after : null;
    if (!after) break;
    if (steps > Math.ceil(total / size) + 2) throw new Error(`цепочка не заканчивается (${steps} шагов при total ${total})`);
  }
  if (seen.length !== total) throw new Error(`пройдено ${seen.length}, total ${total}`);
  if (new Set(seen).size !== seen.length) throw new Error("в цепочке есть повторы — порядок неполный");
  // Совпадение МНОЖЕСТВ — минимум; порядок сверяется отдельно и он детерминирован,
  // потому что `created_at` в демо ставится `clock_timestamp()` (уникален на строку),
  // а keyset-порядок дополняется `id ASC` на сервере.
  const pages = [];
  for (let n = 1; n <= Math.ceil(total / size); n++)
    pages.push(...(await api(`size=${size}&page=${n}`)).body.items.map((i) => i.id));
  if (new Set(pages).size !== seen.length) throw new Error("множества id разошлись со списком по номерам");
  if (pages.join() !== seen.join()) throw new Error("ключевой порядок ≠ постраничному: " + seen.slice(0, 2) + " / " + pages.slice(0, 2));
  return `${steps} шагов, ${seen.length} = total, порядок совпадает с ?page=N`;
});
await step("API: битый токен = 400 с объяснением, а не чужая страница", async () => {
  const { status, body } = await api("size=3&cur=1&after=" + encodeURIComponent("не-токен"));
  if (status === 200) throw new Error("чужой токен принят: " + JSON.stringify(body).slice(0, 120));
  if (status !== 400) throw new Error(`ожидался 400, а ${status}: ` + JSON.stringify(body).slice(0, 120));
  const text = String(body?.error ?? "");
  if (!/токен/i.test(text)) throw new Error("в ответе нет объяснения: " + text.slice(0, 120));
  if (/Internal|undefined|\[object/i.test(text)) throw new Error("текст нечитаем: " + text.slice(0, 120));
  return `400 code=${body?.code}, «${text.slice(0, 44)}…»`;
});
/* ─── тот же источник на второй странице (демо-пагинатор) ─── */
await step("/paginator: пункт «БД» рисует те же строки, что /db-demo", async () => {
  const html = await (await fetch(APP + "?page.src=db&page.size=5", { headers: { accept: "text/html" } })).text();
  const here = [...html.matchAll(/data-testid="db-([0-9a-f-]{8,})"/g)].map((m) => m[1]);
  if (!here.length) throw new Error("записей БД в демо-пагинаторе нет: " + html.slice(0, 140));
  const there = ids((await body()).html);
  if (here.join() !== there.slice(0, here.length).join())
    throw new Error(`разошлись с /db-demo: ${here[0]} / ${there[0]}`);
  if (/data-testid="error-row"/.test(html)) throw new Error("список в отказе: " + html.slice(0, 140));
  return `${here.length} одинаковых с /db-demo строк (SSR через слой, не через API)`;
});
await step("/paginator: курсор — возможность источника: у «БД» токен, у «товаров» — нет", async () => {
  const db = await (await fetch(APP + "?page.src=db&page.size=5&page.cur=1&page.bottomTrigger=manual", { headers: { accept: "text/html" } })).text();
  const pr = await (await fetch(APP + "?page.src=products&page.size=5&page.cur=1", { headers: { accept: "text/html" } })).text();
  // Ссылка «показать ещё» с токеном — то же самое, что рисует /db-demo: разметка
  // разная (хост демо), продолжение — одно и то же (источник).
  const link = /<a [^>]*href="[^"]*page\.after=([^&#"]+)[^"]*"[^>]*data-testid="load-next"/.exec(db);
  if (!link) throw new Error("у источника «БД» ссылки подгрузки с указателем нет");
  if (/page\.after=/.test(pr)) throw new Error("товарам выдан указатель, которого у них нет");
  if (!/data-testid="page-nav"/.test(pr)) throw new Error("у товаров пропали номера страниц из-за чужого ключа");
  return `БД: токен ${decodeURIComponent(link[1]).slice(0, 10)}… в load-next; товары: указателя нет, PageNav жив`;
});

await step("в HTML нет «Cannot find module»/«is not exported»", async () => {
  const html = (await body()).html;
  const bad = /Cannot find module|is not exported|Failed to resolve import|kit-db.*undefined/.exec(html);
  if (bad) throw new Error(bad[0]);
  return "чисто";
});

console.log(failed ? `\nINTEGRATION_HTTP_FAIL: ${failed}` : `\nINTEGRATION_HTTP_OK (${results.length} проверок)`);
process.exit(failed ? 1 : 0);
