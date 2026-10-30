<script lang="ts">
import { Button } from '#components/ui/index.js'
  import { useHeadSeo } from '#components/shell/index.js'
  import { goto } from '$app/navigation';
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

  // Transient-записи — из page.state, в URL их нет. Форму состояния объявляет
  // сама страница (это её shallow-записи), поэтому сужаем `unknown` до неё,
  // а не глушим тип через `any`: страница читает только своё.
  type Transient = { id: string; at: number };
  const pageState = $derived(page.state as { transient?: Transient[]; depth?: number | null });
  const transient = $derived(Array.isArray(pageState.transient) ? pageState.transient : []);
  const depthMark = $derived(pageState.depth ?? null);

  // Полная цепочка: transient всегда СВЕРХУ (позиционное кодирование URL
  // не даёт вставить несериализуемую запись в середину)
  const fullChain = $derived([...urlChain, ...transient.map((t) => `${t.id}*`)]);

  function urlFor(chain: string[]): string {
    const u = new URL(location.href);
    if (chain.length === 0) u.searchParams.delete(CHAIN_KEY);
    else u.searchParams.set(CHAIN_KEY, chain.join(','));
    return u.pathname + (u.search || '') ;
  }

  async function openRegistered(name: string) {
    const next = [...urlChain, name];
    await goto(urlFor(next), { shallow: true, state: { depth: next.length + transient.length } });
    note(`openRegistered('${name}') → goto(url=${urlFor(next)}, { shallow })`);
    rawHistoryState = readRaw();
    locHref = location.pathname + location.search;
    locSearch = location.search;
  }

  // Вариант Б: настоящая навигация роутером. Проверяем, обновится ли page.url.
  async function openViaGoto(name: string) {
    const next = [...urlChain, name];
    await goto(urlFor(next), { reset: false });
    note(`openViaGoto('${name}') → goto(${urlFor(next)})`);
    rawHistoryState = readRaw();
    locHref = location.pathname + location.search;
    locSearch = location.search;
  }

  let transientSeq = 0;
  async function openTransient() {
    const id = `t${++transientSeq}`;
    const next = [...transient, { id, at: Date.now() }];
    // URL НЕ меняется: '' — остаёмся на текущем адресе
    await goto('', { shallow: true, state: { transient: next, depth: urlChain.length + next.length } });
    note(`openTransient('${id}') → goto('', { shallow, state: {transient:[${next.length}]} }) — URL не тронут`);
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

  async function replaceTop() {
    await goto('', { shallow: true, replace: true, state: { transient, depth: fullChain.length, touched: Date.now() } });
    note('goto({ shallow, replace }) — запись истории заменена, «Вперёд» должен уцелеть');
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
  // Оформление страницы — семантические токены shadcn/ui (работают в обеих темах).
  const CODE = 'rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground'
  const PRE =
    'm-0 overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap break-all text-foreground'

  useHeadSeo({
    subTitle: 'Спайк: модель истории',
    description:
      'Песочница совместной работы URL-цепочки ?modal= и transient-состояния в page.state SvelteKit.',
  })
</script>

<!--
  Оформление страницы — семантические токены темы (lemonade / night).
-->
<div class="min-h-dvh bg-background font-sans text-sm leading-relaxed text-foreground">
  <main class="mx-auto flex max-w-5xl flex-col gap-6 px-4 pt-8 pb-16">
    <header class="flex flex-col gap-2">
      <h1 class="text-3xl font-semibold tracking-tight">Спайк модели истории</h1>
      <p class="max-w-2xl text-sm text-muted-foreground">
        Проверяем фундамент порта до того, как писать хост: уживаются ли URL-цепочка
        и transient-слои в одной истории браузера.
      </p>
    </header>

    <section class="grid grid-cols-1 gap-4 min-[760px]:grid-cols-2">
      <div class="flex flex-col gap-3 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        <h2 class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Состояние</h2>
        <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm [&_dd]:tabular-nums">
          <dt class="text-muted-foreground">URL-цепочка <code class={CODE}>?modal=</code></dt>
          <dd>{urlChain.length ? urlChain.join(' → ') : '—'}</dd>
          <dt class="text-muted-foreground">transient (в <code class={CODE}>page.state</code>, не в URL)</dt>
          <dd>{transient.length ? transient.map((t: any) => t.id).join(' → ') : '—'}</dd>
          <dt class="text-muted-foreground">полная цепочка</dt>
          <dd class="font-semibold text-success">{fullChain.length ? fullChain.join(' → ') : 'пусто'}</dd>
          <dt class="text-muted-foreground">метка глубины</dt>
          <dd>{depthMark ?? '— (потеряна: перезагрузка?)'}</dd>
          <dt class="text-muted-foreground">location.href (адресная строка)</dt>
          <dd><code class={`${CODE} break-all`}>{mounted ? locHref : '—'}</code></dd>
          <dt class="text-muted-foreground">page.url (что видит приложение)</dt>
          <dd><code class={`${CODE} break-all`}>{page.url.pathname}{page.url.search}</code></dd>
        </dl>
      </div>

      <div class="flex flex-col gap-3 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        <h2 class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Действия</h2>
        <div class="flex flex-wrap gap-2">
          <Button variant="default" size="sm" onclick={() => openRegistered('card')}>shallow + «card»</Button>
          <Button variant="default" size="sm" onclick={() => openRegistered('user')}>shallow + «user»</Button>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onclick={() => openViaGoto('card')}>goto + «card»</Button>
          <Button variant="secondary" size="sm" onclick={() => openViaGoto('user')}>goto + «user»</Button>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onclick={openTransient}>+ transient (без URL)</Button>
          <Button variant="outline" size="sm" onclick={replaceTop}>shallow replace</Button>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onclick={closeTop} disabled={!fullChain.length}>Закрыть верхний (back)</Button>
          <Button variant="outline" size="sm" onclick={() => closeN(2)} disabled={fullChain.length < 2}>go(-2)</Button>
        </div>
        <p class="text-xs text-muted-foreground">
          Дальше — кнопками <b>Назад / Вперёд</b> самого браузера, и <b>F5</b> на
          непустой цепочке. Это и есть проверка.
        </p>
      </div>
    </section>

    <section class="flex flex-col gap-3 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
      <h2 class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Сырой <code class={CODE}>history.state</code> (что туда кладёт SvelteKit)</h2>
      <pre class={PRE}>{rawHistoryState}</pre>
      <p class="text-xs text-muted-foreground">
        Ключи <code class={CODE}>sveltekit:*</code> — внутренние. Писать в <code class={CODE}>history.state</code>
        напрямую нельзя: роутер SvelteKit это перетрёт и предупредит в консоли.
      </p>
    </section>

    <section class="flex flex-col gap-3 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
      <h2 class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Журнал</h2>
      <pre class={`${PRE} max-h-60 overflow-y-auto`}>{log.join('\n') || '—'}</pre>
    </section>
  </main>
</div>

