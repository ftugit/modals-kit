#!/usr/bin/env node
/**
 * Сквозная проверка собранного пакета на приложенном SvelteKit-приложении — БЕЗ браузера.
 * Нужен только запущенный превью/дев-сервер:
 *
 *   node src/lib/db/probes/http-roundtrip.mjs [http://127.0.0.1:5173/db-demo]
 *
 * Покрывает то, что не покрывают юнит-тесты: импорт `defineResource` в реальном Kit
 * (проверка формы конфигурации не роняет модуль), SSR-список, action create/remove,
 * фильтр и отказ на мусорные параметры. Playwright здесь не нужен: `use:enhance`
 * в демо не завязан на проверку, а состояние перечитывается GET'ом.
 *
 * Список демо — пагинатор приложения, поэтому и ключи адреса его (`?db`, `?db.size`,
 * `?db.flt`), а строки считаются по метке `data-testid="row"`: размечает их `PageList`,
 * и полагаться на `<table>` здесь значит проверять случайное. Пробега приложения
 * (`probes/db-demo-http.check.mjs`) этот зонд не заменяет и не дублирует по назначению:
 * он проверяет ПУБЛИЧНЫЙ контракт слоя на чужом дереве (tarball → приложение), без
 * знания о внутренних тестах.
 */
const BASE = process.argv[2] ?? "http://127.0.0.1:5173/db-demo";
const ORIGIN = new URL(BASE).origin;
/** Каноническая форма фильтра слоя: `{op, field, value}` — её разбирает `parseListInput`. */
const eq = (field, value) => encodeURIComponent(JSON.stringify({ op: "eq", field, value }));

async function raw(url, { data, cookie } = {}) {
  const res = await fetch(url, {
    method: data ? "POST" : "GET",
    redirect: "manual",
    body: data,
    headers: {
      accept: "text/html",
      ...(data ? { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" } : {}),
      ...(cookie ? { cookie } : {}),
    },
  });
  return { status: res.status, html: await res.text(), cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

const rows = (html) => (html.match(/data-testid="row"/g) ?? []).length;
const ids = (html) => [...html.matchAll(/data-testid="row-id">([0-9a-f-]{8,})</g)].map((m) => m[1]);
const total = (html) => Number(html.match(/data-testid="total"[^>]*>(\d+)</)?.[1] ?? NaN);
/**
 * Конверт формы (`__form_id`/`__form_rev`/`__form_instance`/`__form_submission`) берётся
 * из HTML той `<form>`, которую собрал слой `lib/form`: `createFormHandler` без него
 * отвечает 400 `envelope.missing`, и проб не вправе выдумывать пары.
 */
function envelope(html, formId) {
  const block = html.split("</form>").find((b) => b.includes(`name="__form_id" value="${formId}"`));
  if (!block) throw new Error(`в HTML нет формы ${formId} с конвертом`);
  const fd = new URLSearchParams();
  for (const m of block.matchAll(/name="(__form_[a-z]+|intent)" value="([^"]*)"/g)) fd.set(m[1], m[2]);
  return fd;
}
const ok = (cond, msg) => {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("  ✓", msg);
};

const main = async () => {
  let res = await raw(BASE);
  ok(res.status === 200, "GET /db-demo = 200");
  const cookie = res.cookie;
  const n0 = rows(res.html);
  ok(n0 >= 1, `SSR-список пагинатора отдан (${n0} строк, без JS-гидрации)`);
  ok(Number.isFinite(total(res.html)) && total(res.html) >= n0, `счётчик записей: ${total(res.html)}`);

  const t0 = total(res.html);
  const victim = ids(res.html)[0];
  ok(!!victim, "id строки напечатан целиком (его копируют в поле удаления)");
  const fd = envelope(res.html, "db_demo_remove");
  fd.set("ids", victim);
  res = await raw(`${BASE}?/remove`, { data: fd, cookie });
  ok(res.status < 500, `POST ?/remove = ${res.status} (303/200 — оба корректны без use:enhance)`);
  res = await raw(BASE);
  ok(total(res.html) === t0 - 1 && !ids(res.html).includes(victim),
    `total ${t0} → ${total(res.html)}, удалённой строки в списке нет`);

  const created = envelope(res.html, "db_demo_create");
  created.set("title", "Проверка после пересборки");
  res = await raw(`${BASE}?/create`, { data: created, cookie });
  ok(res.status < 500, `POST ?/create = ${res.status}`);
  res = await raw(BASE);
  ok(rows(res.html) === n0 && total(res.html) === t0 && res.html.includes("Проверка после пересборки"),
    `страница по-прежнему ${n0} строк, total вернулся к ${t0}, созданная — в выдаче`);

  res = await raw(`${BASE}?db.flt=${eq("title", "Проверка после пересборки")}`);
  ok(res.status === 200 && rows(res.html) === 1, `?db.flt=<фильтр слоя> → 1 строка (получено ${rows(res.html)})`);
  ok(total(res.html) === 1, "total посчитан по тому же фильтру");
  res = await raw(`${BASE}?db.ord=${encodeURIComponent(JSON.stringify([["title", "asc"]]))}`);
  ok(res.status === 200 && rows(res.html) === n0, `?db.ord=[["title","asc"]] → тот же объём строк в другом порядке`);

  // Мусорные значения отбивает разбор слоя: на странице — состояние error
  // (пагинатор показывает причину), на эндпоинте — 4xx с кодом; лишние ключи
  // адреса до слоя не доходят, потому что у эндпоинта фиксированный набор ключей.
  res = await raw(`${BASE}?db.flt=zzz`);
  ok(res.status === 200 && /data-testid="error-row"/.test(res.html), "битый фильтр на странице = ErrorRow, не 500");
  const bad = await fetch(`${ORIGIN}/api/db-posts?page=1&flt=zzz`);
  ok(bad.status === 422, `битый фильтр на эндпоинте = ${bad.status} validation`);
  // У эндпоинта фиксированный набор ключей (page/size/flt/ord): лишнее до слоя
  // не доходит физически, а числа вне диапазона зажимает слой.
  const clamp = await fetch(`${ORIGIN}/api/db-posts?page=0&size=999&nope=1`);
  const clampBody = await clamp.json().catch(() => ({}));
  ok(clamp.status === 200 && Array.isArray(clampBody.items) && clampBody.items.length <= 100,
    `page=0&size=999&nope=1 → ${clamp.status}, размер зажат максимумом слоя (${clampBody.items?.length ?? "?"} строк)`);
  console.log("HTTP_ROUNDTRIP_OK");
};
try {
  await main();
} catch (e) {
  console.error(`не удалось связаться с ${BASE}: ${e?.cause?.code ?? e?.message ?? e}`);
  console.error("нужен запущенный dev-сервер приложения: npm run dev -- --port 5173");
  process.exit(1);
}
