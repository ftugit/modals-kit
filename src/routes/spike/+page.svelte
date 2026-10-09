<script lang="ts">
import { Button } from '$lib/ui/primitives'
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
  // Оформление страницы: утилиты вместо прежнего блочного стиля.
  const CODE_BASE = 'rounded-[5px] border border-[#252a34] bg-[#0f1115] px-1 py-0.5'
  const CODE = `${CODE_BASE} text-[0.85em]`
  const CODE_MONO = `${CODE_BASE} text-[0.8em]`
  const BTN_BASE =
    'flex-[1_1_auto] cursor-pointer rounded-lg px-[0.8rem] py-[0.55rem] text-[0.9rem] font-medium text-white enabled:hover:brightness-[1.12] disabled:cursor-not-allowed disabled:bg-[#2a2f3a] disabled:text-[#666e7d]'
  const BTN = `${BTN_BASE} bg-[#2d6cdf]`
  const BTN_GO = `${BTN_BASE} bg-[#1f8a58]`
  const BTN_ALT = `${BTN_BASE} bg-[#6b4fd6]`
  const PRE =
    'm-0 overflow-x-auto rounded-lg border border-[#252a34] bg-[#0f1115] px-3.5 py-[0.7rem] text-[0.8rem] whitespace-pre-wrap break-all'
</script>

<svelte:head><title>Спайк: модель истории</title></svelte:head>

<!--
  Оформление страницы — утилиты, а не прежний блочный стиль: app.css хранит
  только токены тем. Тёмная тема спайка набрана цветами прямо в классах.
-->
<div class="min-h-dvh bg-[#0f1115] font-sans text-[15px] leading-[1.55] text-[#e6e8eb] [&_h1]:mb-1.5 [&_h1]:text-[1.6rem] [&_h2]:mb-3.5 [&_h2]:text-[0.78rem] [&_h2]:font-semibold [&_h2]:tracking-[0.08em] [&_h2]:text-[#8b93a1] [&_h2]:uppercase [&_dt]:text-[0.85rem] [&_dt]:text-[#8b93a1] [&_dd]:m-0 [&_dd]:tabular-nums [&_h1]:tracking-[-0.01em] [&_h2]:text-[0.8rem]">
  <main class="mx-auto max-w-[68rem] px-5 pt-8 pb-16">
    <h1>Спайк модели истории</h1>
    <p class="mb-7 max-w-[46rem] text-[#9aa3b2]">
      Проверяем фундамент порта до того, как писать хост: уживаются ли URL-цепочка
      и transient-слои в одной истории браузера.
    </p>

    <section class="grid grid-cols-1 gap-4 min-[760px]:grid-cols-2">
      <div class="mb-4 rounded-xl border border-[#252a34] bg-[#171a21] px-[1.2rem] py-[1.1rem]">
        <h2>Состояние</h2>
        <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt>URL-цепочка <code class={CODE}>?modal=</code></dt>
          <dd>{urlChain.length ? urlChain.join(' → ') : '—'}</dd>
          <dt>transient (в <code class={CODE}>page.state</code>, не в URL)</dt>
          <dd>{transient.length ? transient.map((t: any) => t.id).join(' → ') : '—'}</dd>
          <dt>полная цепочка</dt>
          <dd class="font-semibold text-[#7ee787]">{fullChain.length ? fullChain.join(' → ') : 'пусто'}</dd>
          <dt>метка глубины</dt>
          <dd>{depthMark ?? '— (потеряна: перезагрузка?)'}</dd>
          <dt>location.href (адресная строка)</dt>
          <dd><code class={CODE_MONO}>{mounted ? locHref : '—'}</code></dd>
          <dt>page.url (что видит приложение)</dt>
          <dd><code class={CODE_MONO}>{page.url.pathname}{page.url.search}</code></dd>
        </dl>
      </div>

      <div class="mb-4 rounded-xl border border-[#252a34] bg-[#171a21] px-[1.2rem] py-[1.1rem]">
        <h2>Действия</h2>
        <div class="mb-2.5 flex flex-wrap gap-2">
          <Button variant="plain" size="none" class={BTN} onclick={() => openRegistered('card')}>pushState + «card»</Button>
          <Button variant="plain" size="none" class={BTN} onclick={() => openRegistered('user')}>pushState + «user»</Button>
        </div>
        <div class="mb-2.5 flex flex-wrap gap-2">
          <Button variant="plain" size="none" class={BTN_GO} onclick={() => openViaGoto('card')}>goto + «card»</Button>
          <Button variant="plain" size="none" class={BTN_GO} onclick={() => openViaGoto('user')}>goto + «user»</Button>
        </div>
        <div class="mb-2.5 flex flex-wrap gap-2">
          <Button variant="plain" size="none" class={BTN_ALT} onclick={openTransient}>+ transient (без URL)</Button>
          <Button variant="plain" size="none" class={BTN_ALT} onclick={replaceTop}>replaceState</Button>
        </div>
        <div class="mb-2.5 flex flex-wrap gap-2">
          <Button variant="plain" size="none" class={BTN} onclick={closeTop} disabled={!fullChain.length}>Закрыть верхний (back)</Button>
          <Button variant="plain" size="none" class={BTN} onclick={() => closeN(2)} disabled={fullChain.length < 2}>go(-2)</Button>
        </div>
        <p class="mt-2.5 text-[0.82rem] text-[#7a8292]">
          Дальше — кнопками <b>Назад / Вперёд</b> самого браузера, и <b>F5</b> на
          непустой цепочке. Это и есть проверка.
        </p>
      </div>
    </section>

    <section class="mb-4 rounded-xl border border-[#252a34] bg-[#171a21] px-[1.2rem] py-[1.1rem]">
      <h2>Сырой <code class={CODE}>history.state</code> (что туда кладёт SvelteKit)</h2>
      <pre class={PRE}>{rawHistoryState}</pre>
      <p class="mt-2.5 text-[0.82rem] text-[#7a8292]">
        Ключи <code class={CODE}>sveltekit:*</code> — внутренние. Писать в <code class={CODE}>history.state</code>
        напрямую нельзя: роутер SvelteKit это перетрёт и предупредит в консоли.
      </p>
    </section>

    <section class="mb-4 rounded-xl border border-[#252a34] bg-[#171a21] px-[1.2rem] py-[1.1rem]">
      <h2>Журнал</h2>
      <pre class={`${PRE} max-h-60 overflow-y-auto`}>{log.join('\n') || '—'}</pre>
    </section>
  </main>
</div>

