<script lang="ts">
  import { onMount } from 'svelte'
  import { createModals, createRegistry, urlStorage } from '$lib/modals'
  import { svelteKitCore } from '$lib/modals/cores/sveltekit'
  import { createReactiveStore } from '$lib/modals/svelte/store.svelte'

  /* ═══════════════════════════════════════════════════════════════
     1. ОБЪЯВЛЕНИЕ. Два места: глобальное и область роута.
     ═══════════════════════════════════════════════════════════════ */

  // Вид 1 «registered», глобально: видно с любого маршрута
  const app = createRegistry('app').define([
    { name: 'auth', component: 'AuthModal', size: { width: 420 } },
  ])

  // Вид 1 «registered», область роута: существует только здесь
  const cycle = app.child('/cycle').define([
    {
      name: 'account',
      component: 'AccountModal',
      size: { width: 560 },
      mobile: 'bottom',
      defaultParams: { tab: 'profile' },
    },
  ])

  /* ═══════════════════════════════════════════════════════════════
     2. СБОРКА. модалка(ядро(хранилище), опции)
     ═══════════════════════════════════════════════════════════════ */

  const core = svelteKitCore(urlStorage(), { lookup: cycle.lookup })
  const modals = createModals(core, { tailCount: 3, maxHeight: '80vh' })

  // Реактивное зеркало стора — единственное место, где ядро встречается
  // с рунами. Раньше здесь был ручной счётчик `tick`, и он ловил гонку:
  // на popstate мой слушатель успевал раньше, чем ядро обновляло стор.
  const view = createReactiveStore(modals.store)

  let ready = $state(false)
  let href = $state('')
  let log = $state<string[]>([])

  const note = (s: string) =>
    (log = [`${new Date().toISOString().slice(14, 22)}  ${s}`, ...log].slice(0, 10))

  const refresh = () => {
    href = location.pathname + location.search
  }

  onMount(() => {
    const off = modals.attach()
    ready = true
    refresh()
    const onPop = () => { refresh(); note('popstate — Назад/Вперёд браузера') }
    addEventListener('popstate', onPop)
    return () => { off(); removeEventListener('popstate', onPop) }
  })

  const chain = $derived(view.chain)
  const top = $derived(chain[chain.length - 1])

  /* ═══════════════════════════════════════════════════════════════
     3. ВЫЗОВ. Три кнопки — три вида записи.
     ═══════════════════════════════════════════════════════════════ */

  let nextId = $state(101)

  function openGlobal() {
    modals.open('auth')
    note("modals.open('auth') — глобальная")
    refresh()
  }

  function openScoped() {
    const id = nextId++
    // ← ВОТ ТАК передаются параметры
    modals.open('account', { params: { id, tab: 'profile' }, mobile: 'bottom' })
    note(`modals.open('account', { params: { id: ${id} } })`)
    refresh()
  }

  function openTransient() {
    const id = modals.openLayer({
      content: { title: 'Удалить учётку?', body: 'Действие необратимо.' },
      size: { width: 380 },
    })
    note(`modals.openLayer({ content }) → ${id}`)
    refresh()
  }

  function close() { modals.close(); note('modals.close()'); refresh() }
  function closeAll() { modals.closeAll(); note('modals.closeAll()'); refresh() }

  const label = (e: any) => (e.kind === 'registered' ? e.name : e.id)
  const params = (e: any) => (e.kind === 'registered' ? e.params : modals.layerContent(e.id))
</script>

<svelte:head><title>Полный цикл модалки</title></svelte:head>

<main>
  <h1>Полный цикл</h1>
  <p class="lead">
    Объявление → вызов с параметрами → цепочка → адрес → Назад.
    Хост ещё не написан, поэтому слои ниже нарисованы примитивно —
    но сама механика настоящая.
  </p>

  <section class="grid">
    <div class="card">
      <h2>Два поддерживаемых вида записи</h2>

      <div class="kind">
        <div class="kind-h"><b>1. registered</b> · глобальный реестр</div>
        <p>Объявлена в <code>createRegistry('app')</code>, видна отовсюду.</p>
        <button onclick={openGlobal} disabled={!ready}>Открыть «auth»</button>
      </div>

      <div class="kind">
        <div class="kind-h"><b>1. registered</b> · область роута</div>
        <p>Объявлена в <code>app.child('/cycle')</code>. С других роутов не видна.
           Параметры уезжают в адрес.</p>
        <button onclick={openScoped} disabled={!ready}>Открыть «account» с id</button>
      </div>

      <div class="kind alt">
        <div class="kind-h"><b>3. transient</b> · слой из кода</div>
        <p>Имени в реестре нет, содержимое передаётся на месте,
           в адрес не попадает.</p>
        <button class="alt" onclick={openTransient} disabled={!ready}>Открыть разовый слой</button>
      </div>

    </div>

    <div class="card">
      <h2>Что получилось</h2>
      <dl>
        <dt>стопка</dt>
        <dd class="strong">{chain.length ? chain.map(label).join(' → ') : 'пусто'}</dd>
        <dt>верхняя запись</dt>
        <dd>{top ? top.kind : '—'}</dd>
        <dt>её данные</dt>
        <dd><code>{top ? JSON.stringify(params(top)) : '—'}</code></dd>
        <dt>адрес</dt>
        <dd><code class="wrap">{href || '—'}</code></dd>
      </dl>

      <div class="row">
        <button onclick={close} disabled={!chain.length}>Закрыть верхнюю</button>
        <button onclick={closeAll} disabled={!chain.length}>Закрыть все</button>
      </div>
      <p class="hint">
        Дальше жмите <b>Назад</b> в браузере: каждое открытие — своя запись
        истории, у transient тоже. Затем <b>F5</b>: записи из адреса вернутся,
        разовый слой — нет.
      </p>
    </div>
  </section>

  <section class="card">
    <h2>Слои (заглушка вместо хоста)</h2>
    {#if chain.length === 0}
      <p class="hint">Стопка пуста.</p>
    {:else}
      <div class="layers">
        {#each chain as entry, i (label(entry))}
          <div class="layer" class:active={i === chain.length - 1}>
            <div class="layer-h">
              <span class="badge" class:t={entry.kind === 'transient'}>{entry.kind}</span>
              <b>{label(entry)}</b>
              <span class="dim">глубина {i + 1} из {chain.length}</span>
            </div>
            <pre>{JSON.stringify(params(entry), null, 2)}</pre>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section class="card">
    <h2>Журнал</h2>
    <pre class="log">{log.join('\n') || '—'}</pre>
  </section>
</main>

<style>
  :global(body) { margin: 0; background: #0f1115; color: #e6e8eb;
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  main { max-width: 70rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  h1 { font-size: 1.6rem; margin: 0 0 .35rem; }
  h2 { font-size: .78rem; text-transform: uppercase; letter-spacing: .08em;
       color: #8b93a1; margin: 0 0 .9rem; font-weight: 600; }
  .lead { color: #9aa3b2; margin: 0 0 1.75rem; max-width: 46rem; }
  .grid { display: grid; gap: 1rem; grid-template-columns: 1fr 1fr; }
  @media (max-width: 820px) { .grid { grid-template-columns: 1fr; } }
  .card { background: #171a21; border: 1px solid #252a34; border-radius: 12px;
          padding: 1.1rem 1.2rem; margin-bottom: 1rem; }
  .kind { border-left: 3px solid #2d6cdf; padding: .1rem 0 .1rem .8rem; margin-bottom: 1.1rem; }
  .kind.alt { border-left-color: #6b4fd6; }
  .kind-h { font-size: .9rem; margin-bottom: .3rem; }
  .kind p { color: #8b93a1; font-size: .84rem; margin: 0 0 .55rem; }
  dl { margin: 0 0 1rem; display: grid; grid-template-columns: auto 1fr; gap: .45rem 1rem; }
  dt { color: #8b93a1; font-size: .85rem; }
  dd { margin: 0; }
  dd.strong { color: #7ee787; font-weight: 600; }
  code { background: #0f1115; border: 1px solid #252a34; border-radius: 5px;
         padding: .05rem .3rem; font-size: .82em; }
  code.wrap { word-break: break-all; }
  .row { display: flex; gap: .5rem; }
  button { background: #2d6cdf; color: #fff; border: 0; border-radius: 8px;
           padding: .5rem .8rem; font-size: .88rem; font-weight: 500; cursor: pointer; }
  button.alt { background: #6b4fd6; }
  button:disabled { background: #2a2f3a; color: #666e7d; cursor: not-allowed; }
  button:not(:disabled):hover { filter: brightness(1.12); }
  .row button { flex: 1; }
  .layers { display: flex; flex-direction: column; gap: .6rem; }
  .layer { border: 1px solid #252a34; border-radius: 8px; padding: .6rem .75rem; opacity: .5; }
  .layer.active { opacity: 1; border-color: #2d6cdf; }
  .layer-h { display: flex; align-items: center; gap: .5rem; margin-bottom: .4rem;
             font-size: .88rem; flex-wrap: wrap; }
  .badge { background: #2d6cdf; border-radius: 4px; padding: .05rem .4rem; font-size: .7rem; }
  .badge.t { background: #6b4fd6; }
  .dim { color: #7a8292; font-size: .78rem; margin-left: auto; }
  pre { background: #0f1115; border: 1px solid #252a34; border-radius: 6px;
        padding: .5rem .7rem; overflow-x: auto; font-size: .78rem; margin: 0;
        white-space: pre-wrap; word-break: break-all; }
  pre.log { max-height: 12rem; overflow-y: auto; }
  .hint { color: #7a8292; font-size: .82rem; margin: .7rem 0 0; }
</style>
