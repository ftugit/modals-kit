const { chromium } = await import('playwright');
const base = 'http://127.0.0.1:5173/db-demo';
const b = await chromium.launch();
const p = await b.newPage();
const consoleErrors = [];
p.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 120)));
const rows = () => p.$$eval('[data-testid="rows"] tbody tr', (e) => e.length).catch(() => -1);
const step = async (name, fn) => { try { console.log(name + ':', await fn()); } catch (e) { console.log(name + ': ИСКЛЮЧЕНИЕ ' + String(e).split('\n')[0]); } };

await p.goto(base, { waitUntil: 'load' });
const seeded = await rows();
console.log('SSR: строк в таблице после сида =', seeded);
await step('SSR: содержимое первой строки', async () => (await p.textContent('[data-testid="raw"]'))?.slice(0, 100));
await step('SSR без JS отдаёт те же строки', async () => {
  const html = await (await fetch(base)).text();
  return /<td><code>[0-9a-f]{8}<\/code><\/td>/.test(html);
});
await step('роль-демо: всего записей', async () => (await p.textContent('p >> strong')));

// короткое имя → ошибка поля (Standard Schema → toFormFailure → form.fieldErrors)
await p.fill('#title', 'ab');
await p.click('form[action="?/create"] button[type=submit]');
await p.waitForLoadState('networkidle');
await step('ошибка поля (role=alert)', async () => (await p.textContent('[role=alert]'))?.trim());
await step('aria-invalid у инпута', async () => await p.getAttribute('#title', 'aria-invalid'));
await step('строк не прибавилось', rows);

// валидное имя → запись вставляется, счётчик растёт
await p.fill('#title', 'Живая запись из адаптации');
await p.click('form[action="?/create"] button[type=submit]');
await p.waitForLoadState('networkidle');
await step('статус после вставки (role=status)', async () => (await p.textContent('[role=status]'))?.trim());
const after = await rows();
console.log('SSR: строк стало =', after, '(было', seeded + ')');
await step('новая запись в выдаче', async () => {
  const t = await p.$$eval('[data-testid="rows"] tbody tr td:nth-child(2)', (e) => e.map((x) => x.textContent));
  return t.includes('Живая запись из адаптации');
});

// удаление own row
await step('удаление строки', async () => {
  await p.click('[data-testid="rows"] tbody tr:first-child form button');
  await p.waitForLoadState('networkidle');
  return await rows();
});

// filter/sort через query (parseListInput) — до удаления, и по сидованному заголовку
await p.goto(base + '?filter=' + encodeURIComponent('{"field":"title","op":"contains","value":"Запись"}'), { waitUntil: 'load' });
await step('после contains-фильтра строк (ожидаем >=1)', async () => {
  const n = await rows();
  if (n < 1) throw new Error('фильтр не нашёл сидованных строк: ' + n);
  return n;
});
await p.goto(base, { waitUntil: 'load' });
await p.goto(base + '?order=' + encodeURIComponent('[["title","asc"]]') + '&limit=2', { waitUntil: 'load' });
await step('order+limit=2 строк', rows);
await p.goto(base + '?sort=title', { waitUntil: 'load' });
await step('неизвестный ключ query → страница ошибки', async () => (await p.textContent('body'))?.includes('validation') ? 'validation (422)' : 'иное');

// остальное приложение не сломано
await step('модалочный маршрут / жив', async () => {
  const r = await fetch('http://127.0.0.1:5173/');
  return r.status + ' ' + (await r.text()).includes('<div');
});
console.log('ошибок в консоли браузера:', consoleErrors.length, consoleErrors.slice(0, 3));
await b.close();
console.log(seeded >= 1 && after === seeded + 1 ? `BROWSER_OK (${seeded} → ${after})` : `BROWSER_MISMATCH: было ${seeded}, стало ${after} (проверь шаги выше)`);
