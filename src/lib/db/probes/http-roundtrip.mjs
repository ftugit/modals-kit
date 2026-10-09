#!/usr/bin/env node
/**
 * Сквозная проверка собранного пакета на приложенном SvelteKit-приложении — БЕЗ браузера.
 * Нужен только dev-сервер: `npm run dev` в копии модал-кита с установленным tarball'ом.
 *
 *   node probe/http-roundtrip.mjs [http://127.0.0.1:5173/db-demo]
 *
 * Покрывает то, что не покрывают юнит-тесты: импорт `defineResource` в реальном Kit
 * (проверка формы конфигурации не роняет модуль), SSR-список, action create/remove,
 * ?filter JSON и отказ на мусорные параметры. Playwright здесь не нужен: `use:enhance`
 * в демо не завязан на проверку, а состояние перечитывается GET'ом.
 */
const BASE = process.argv[2] ?? "http://127.0.0.1:5173/db-demo";

async function raw(url, { data, cookie } = {}) {
  const res = await fetch(url, {
    method: data ? "POST" : "GET",
    redirect: "manual",
    body: data,
    headers: {
      ...(data ? { origin: new URL(BASE).origin, "content-type": "application/x-www-form-urlencoded" } : {}),
      ...(cookie ? { cookie } : {}),
    },
  });
  return { status: res.status, html: await res.text(), cookie: res.headers.get("set-cookie")?.split(";")[0] };
}
const cells = (html) =>
  html.includes("<table")
    ? [...html.slice(html.indexOf("<table")).matchAll(/<td[^>]*>(?:<!--\[--\]>)?([^<]{1,40})/g)].map((m) => m[1])
    : [];
const rows = (html) => Math.floor(cells(html).length / 2);
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
ok(n0 >= 1, `SSR-список отдан (${n0} строк, без JS-гидрации)`);

const victim = res.html.match(/name="ids"[^>]*value="([^"]+)"/)?.[1];
ok(!!victim, "в разметке есть чекбоксы удаления со значениями id");
res = await raw(`${BASE}?/remove`, { data: new URLSearchParams({ ids: victim }), cookie });
ok(res.status < 500, `POST ?/remove = ${res.status} (303/200 — оба корректны без use:enhance)`);
res = await raw(BASE);
ok(rows(res.html) === n0 - 1, `после удаления ${n0} → ${rows(res.html)}`);

res = await raw(`${BASE}?/create`, { data: new URLSearchParams({ title: "Проверка после пересборки" }), cookie });
ok(res.status < 500, `POST ?/create = ${res.status}`);
res = await raw(BASE);
ok(rows(res.html) === n0, `счётчик вернулся к ${n0}`);
ok(cells(res.html).some((c) => c.startsWith("Проверка после")), "созданная строка видна в SSR");

const filter = encodeURIComponent(JSON.stringify({ field: "title", op: "contains", value: "Проверка после" }));
res = await raw(`${BASE}?filter=${filter}`);
ok(res.status === 200 && rows(res.html) === 1, `?filter=<json> → 1 строка (получено ${rows(res.html)})`);
for (const [bad, want] of [["?nope=1", 422], ["?filter=zzz", 422]]) {
  res = await raw(BASE + bad);
  ok(res.status === want, `${bad} → ${want} (получено ${res.status})`);
}
console.log("HTTP_ROUNDTRIP_OK");
};
try {
  await main();
} catch (e) {
  console.error(`не удалось связаться с ${BASE}: ${e?.cause?.code ?? e?.message ?? e}`);
  console.error("нужен запущенный dev-сервер приложения: npm run dev -- --port 5173");
  process.exit(1);
}
