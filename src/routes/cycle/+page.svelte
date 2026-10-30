<script lang="ts">
import { Button } from '#components/ui/index.js'
  import { useHeadSeo } from '#components/shell/index.js'
  import { onMount } from 'svelte'
  import { createModals, createRegistry, urlStorage } from '#lib/modals/index.js'
  import { svelteKitCore } from '#lib/modals/cores/sveltekit.js'
  import { createReactiveStore } from '#lib/modals/svelte/index.js'

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
  // Оформление страницы — семантические токены shadcn/ui (работают в обеих темах).
  const CODE = 'rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground'
  const PRE =
    'm-0 overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap break-all text-foreground'

  useHeadSeo({
    subTitle: 'Полный цикл модалки',
    description:
      'Демонстрация полного цикла жизни модальной записи в адресе и истории браузера без хоста.',
  })
</script>

<!--
  Оформление страницы — семантические токены темы (lemonade / night).
-->
<div class="min-h-dvh bg-background font-sans text-sm leading-relaxed text-foreground">
  <main class="mx-auto flex max-w-5xl flex-col gap-6 px-4 pt-8 pb-16">
    <header class="flex flex-col gap-2">
      <h1 class="text-3xl font-semibold tracking-tight">Полный цикл</h1>
      <p class="max-w-2xl text-sm text-muted-foreground">
        Объявление → вызов с параметрами → цепочка → адрес → Назад.
        Хост ещё не написан, поэтому слои ниже нарисованы примитивно —
        но сама механика настоящая.
      </p>
    </header>

    <section class="grid grid-cols-1 gap-4 min-[820px]:grid-cols-2">
      <div class="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        <h2 class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Два поддерживаемых вида записи</h2>

        <div class="flex flex-col gap-2 border-l-2 border-l-primary pl-3">
          <div class="text-sm"><b>1. registered</b> · глобальный реестр</div>
          <p class="text-xs text-muted-foreground">Объявлена в <code class={CODE}>createRegistry('app')</code>, видна отовсюду.</p>
          <Button variant="default" size="sm" class="self-start" onclick={openGlobal} disabled={!ready}>Открыть «auth»</Button>
        </div>

        <div class="flex flex-col gap-2 border-l-2 border-l-primary pl-3">
          <div class="text-sm"><b>1. registered</b> · область роута</div>
          <p class="text-xs text-muted-foreground">Объявлена в <code class={CODE}>app.child('/cycle')</code>. С других роутов не видна.
             Параметры уезжают в адрес.</p>
          <Button variant="default" size="sm" class="self-start" onclick={openScoped} disabled={!ready}>Открыть «account» с id</Button>
        </div>

        <div class="flex flex-col gap-2 border-l-2 border-l-muted-foreground pl-3">
          <div class="text-sm"><b>3. transient</b> · слой из кода</div>
          <p class="text-xs text-muted-foreground">Имени в реестре нет, содержимое передаётся на месте,
             в адрес не попадает.</p>
          <Button variant="secondary" size="sm" class="self-start" onclick={openTransient} disabled={!ready}>Открыть разовый слой</Button>
        </div>

      </div>

      <div class="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        <h2 class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Что получилось</h2>
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt class="text-muted-foreground">стопка</dt>
          <dd class="font-semibold text-success">{chain.length ? chain.map(label).join(' → ') : 'пусто'}</dd>
          <dt class="text-muted-foreground">верхняя запись</dt>
          <dd>{top ? top.kind : '—'}</dd>
          <dt class="text-muted-foreground">её данные</dt>
          <dd><code class="font-mono text-xs">{top ? JSON.stringify(params(top)) : '—'}</code></dd>
          <dt class="text-muted-foreground">адрес</dt>
          <dd><code class={`${CODE} break-all`}>{href || '—'}</code></dd>
        </dl>

        <div class="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onclick={close} disabled={!chain.length}>Закрыть верхнюю</Button>
          <Button variant="outline" size="sm" onclick={closeAll} disabled={!chain.length}>Закрыть все</Button>
        </div>
        <p class="text-xs text-muted-foreground">
          Дальше жмите <b>Назад</b> в браузере: каждое открытие — своя запись
          истории, у transient тоже. Затем <b>F5</b>: записи из адреса вернутся,
          разовый слой — нет.
        </p>
      </div>
    </section>

    <section class="flex flex-col gap-3 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
      <h2 class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Слои (заглушка вместо хоста)</h2>
      {#if chain.length === 0}
        <p class="text-xs text-muted-foreground">Стопка пуста.</p>
      {:else}
        <div class="flex flex-col gap-2.5">
          {#each chain as entry, i (label(entry))}
            <div
              class="rounded-lg border border-border p-3.5 opacity-60 data-[active]:border-primary data-[active]:bg-muted/20 data-[active]:opacity-100"
              data-active={i === chain.length - 1 ? '' : undefined}
            >
              <div class="mb-2 flex flex-wrap items-center gap-2 text-sm">
                <span class="rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground data-[kind=transient]:bg-secondary data-[kind=transient]:text-secondary-foreground" data-kind={entry.kind}>{entry.kind}</span>
                <b>{label(entry)}</b>
                <span class="ml-auto text-xs text-muted-foreground">глубина {i + 1} из {chain.length}</span>
              </div>
              <pre class={PRE}>{JSON.stringify(params(entry), null, 2)}</pre>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <section class="flex flex-col gap-3 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
      <h2 class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Журнал</h2>
      <pre class={`${PRE} max-h-48 overflow-y-auto`}>{log.join('\n') || '—'}</pre>
    </section>
  </main>
</div>

