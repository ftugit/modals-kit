<script lang="ts">
  import { goto, pushState, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';

  /* ─────────────────────────────────────────────────────────────
     СПАЙК: модель истории для цепочки модалок.
     Проверяет ровно то, от чего зависит весь порт, и ничего больше.

     Вопросы:
       1. Живут ли вместе URL-цепочка (?modal=) и transient (page.state)?
       2. Переживает ли page.state перезагрузку? (док говорит: НЕТ)
       3. Работает ли history.go(-n) при n > 1?
       4. Как выглядит сырой history.state под SvelteKit?
     ───────────────────────────────────────────────────────────── */

  const CHAIN_KEY = 'modal';

  let log = $state<string[]>([]);
  let rawHistoryState = $state('—');
  let mounted = $state(false);
  let locHref = $state('');
  let locSearch = $state('');

  const note = (s: string) =>
    (log = [`${new Date().toISOString().slice(11, 23)}  ${s}`, ...log].slice(0, 14));

  const readRaw = () => {
    if (typeof history === 'undefined') return '—';
    try {
      return JSON.stringify(history.state);
    } catch {
      return '<не сериализуется>';
    }
  };

  // Цепочка зарегистрированных записей — из URL, как в оригинале
  const urlChain = $derived(
    (new URLSearchParams(locSearch).get(CHAIN_KEY) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  // Transient-записи — из page.state, в URL их нет
  const transient = $derived((page.state as any).transient ?? []);
  const depthMark = $derived((page.state as any).depth ?? null);

  // Полная цепочка: transient всегда СВЕРХУ (позиционное кодирование URL
  // не даёт вставить несериализуемую запись в середину)
  const fullChain = $derived([...urlChain, ...transient.map((t: any) => `${t.id}*`)]);

  function urlFor(chain: string[]): string {
    const u = new URL(location.href);
    if (chain.length === 0) u.searchParams.delete(CHAIN_KEY);
    else u.searchParams.set(CHAIN_KEY, chain.join(','));
    return u.pathname + (u.search || '') ;
  }

  function openRegistered(name: string) {
    const next = [...urlChain, name];
    pushState(urlFor(next), { depth: next.length + transient.length } as any);
    note(`openRegistered('${name}') → pushState(url=${urlFor(next)})`);
    rawHistoryState = readRaw();
    locHref = location.pathname + location.search;
    locSearch = location.search;
  }

  // Вариант Б: настоящая навигация роутером. Проверяем, обновится ли page.url.
  async function openViaGoto(name: string) {
    const next = [...urlChain, name];
    await goto(urlFor(next), { noScroll: true, keepFocus: true });
    note(`openViaGoto('${name}') → goto(${urlFor(next)})`);
    rawHistoryState = readRaw();
    locHref = location.pathname + location.search;
    locSearch = location.search;
  }

  let transientSeq = 0;
  function openTransient() {
    const id = `t${++transientSeq}`;
    const next = [...transient, { id, at: Date.now() }];
    // URL НЕ меняется: '' — остаёмся на текущем адресе
    pushState('', { transient: next, depth: urlChain.length + next.length } as any);
    note(`openTransient('${id}') → pushState('', {transient:[${next.length}]}) — URL не тронут`);
    rawHistoryState = readRaw();
    locHref = location.pathname + location.search;
    locSearch = location.search;
  }

  function closeTop() {
    note(`closeTop() → history.back()  [глубина была ${fullChain.length}]`);
    history.back();
  }

  function closeN(n: number) {
    note(`closeN(${n}) → history.go(-${n})`);
    history.go(-n);
  }

  function replaceTop() {
    replaceState('', { transient, depth: fullChain.length, touched: Date.now() } as any);
    note('replaceState — запись истории заменена, «Вперёд» должен уцелеть');
    rawHistoryState = readRaw();
    locHref = location.pathname + location.search;
    locSearch = location.search;
  }

  onMount(() => {
    mounted = true;
    rawHistoryState = readRaw();
    locHref = location.pathname + location.search;
    locSearch = location.search;
    note(
      `mount. URL-цепочка=[${urlChain.join(',')}] transient=[${transient.length}] ` +
        `page.state=${JSON.stringify(page.state)}`,
    );
    const onPop = () => {
      rawHistoryState = readRaw();
      locHref = location.pathname + location.search;
    locSearch = location.search;
      note(`popstate → URL=[${urlChain.join(',')}] transient=${transient.length}`);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });
</script>

<svelte:head><title>Спайк: модель истории</title></svelte:head>

<main>
  <h1>Спайк модели истории</h1>
  <p class="lead">
    Проверяем фундамент порта до того, как писать хост: уживаются ли URL-цепочка
    и transient-слои в одной истории браузера.
  </p>

  <section class="grid">
    <div class="card">
      <h2>Состояние</h2>
      <dl>
        <dt>URL-цепочка <code>?modal=</code></dt>
        <dd>{urlChain.length ? urlChain.join(' → ') : '—'}</dd>
        <dt>transient (в <code>page.state</code>, не в URL)</dt>
        <dd>{transient.length ? transient.map((t: any) => t.id).join(' → ') : '—'}</dd>
        <dt>полная цепочка</dt>
        <dd class="strong">{fullChain.length ? fullChain.join(' → ') : 'пусто'}</dd>
        <dt>метка глубины</dt>
        <dd>{depthMark ?? '— (потеряна: перезагрузка?)'}</dd>
        <dt>location.href (адресная строка)</dt>
        <dd><code class="mono">{mounted ? locHref : '—'}</code></dd>
        <dt>page.url (что видит приложение)</dt>
        <dd><code class="mono">{page.url.pathname}{page.url.search}</code></dd>
      </dl>
    </div>

    <div class="card">
      <h2>Действия</h2>
      <div class="row">
        <button onclick={() => openRegistered('card')}>pushState + «card»</button>
        <button onclick={() => openRegistered('user')}>pushState + «user»</button>
      </div>
      <div class="row">
        <button class="go" onclick={() => openViaGoto('card')}>goto + «card»</button>
        <button class="go" onclick={() => openViaGoto('user')}>goto + «user»</button>
      </div>
      <div class="row">
        <button class="alt" onclick={openTransient}>+ transient (без URL)</button>
        <button class="alt" onclick={replaceTop}>replaceState</button>
      </div>
      <div class="row">
        <button onclick={closeTop} disabled={!fullChain.length}>Закрыть верхний (back)</button>
        <button onclick={() => closeN(2)} disabled={fullChain.length < 2}>go(-2)</button>
      </div>
      <p class="hint">
        Дальше — кнопками <b>Назад / Вперёд</b> самого браузера, и <b>F5</b> на
        непустой цепочке. Это и есть проверка.
      </p>
    </div>
  </section>

  <section class="card">
    <h2>Сырой <code>history.state</code> (что туда кладёт SvelteKit)</h2>
    <pre>{rawHistoryState}</pre>
    <p class="hint">
      Ключи <code>sveltekit:*</code> — внутренние. Писать в <code>history.state</code>
      напрямую нельзя: роутер SvelteKit это перетрёт и предупредит в консоли.
    </p>
  </section>

  <section class="card">
    <h2>Журнал</h2>
    <pre class="log">{log.join('\n') || '—'}</pre>
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #0f1115;
    color: #e6e8eb;
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  main { max-width: 68rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  h1 { font-size: 1.6rem; margin: 0 0 .35rem; letter-spacing: -.01em; }
  h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .08em;
       color: #8b93a1; margin: 0 0 .9rem; font-weight: 600; }
  .lead { color: #9aa3b2; margin: 0 0 1.75rem; max-width: 46rem; }
  .grid { display: grid; gap: 1rem; grid-template-columns: 1fr 1fr; }
  @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }
  .card { background: #171a21; border: 1px solid #252a34; border-radius: 12px;
          padding: 1.1rem 1.2rem; margin-bottom: 1rem; }
  dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: .45rem 1rem; }
  dt { color: #8b93a1; font-size: .85rem; }
  dd { margin: 0; font-variant-numeric: tabular-nums; }
  dd.strong { color: #7ee787; font-weight: 600; }
  code { background: #0f1115; border: 1px solid #252a34; border-radius: 5px;
         padding: .05rem .3rem; font-size: .85em; }
  .row { display: flex; gap: .5rem; margin-bottom: .55rem; flex-wrap: wrap; }
  button { flex: 1 1 auto; background: #2d6cdf; color: #fff; border: 0;
           border-radius: 8px; padding: .55rem .8rem; font-size: .9rem;
           font-weight: 500; cursor: pointer; }
  button.alt { background: #6b4fd6; }
  button.go { background: #1f8a58; }
  .mono { font-size: .8em; }
  button:disabled { background: #2a2f3a; color: #666e7d; cursor: not-allowed; }
  button:not(:disabled):hover { filter: brightness(1.12); }
  pre { background: #0f1115; border: 1px solid #252a34; border-radius: 8px;
        padding: .7rem .85rem; overflow-x: auto; font-size: .8rem; margin: 0;
        white-space: pre-wrap; word-break: break-all; }
  pre.log { max-height: 15rem; overflow-y: auto; }
  .hint { color: #7a8292; font-size: .82rem; margin: .7rem 0 0; }
</style>
