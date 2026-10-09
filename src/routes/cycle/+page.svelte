<script lang="ts">
import { Button } from '$lib/ui/primitives'
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
  // Оформление страницы: утилиты вместо прежнего блочного стиля.
  const CODE = 'rounded-[5px] border border-[#252a34] bg-[#0f1115] px-1 py-0.5 text-[0.82em]'
  const BTN_BASE =
    'flex-1 cursor-pointer rounded-lg px-3 py-2 text-[0.88rem] font-medium text-white enabled:hover:brightness-[1.12] disabled:cursor-not-allowed disabled:bg-[#2a2f3a] disabled:text-[#666e7d]'
  const BTN = `${BTN_BASE} bg-[#2d6cdf]`
  const BTN_ALT = `${BTN_BASE} bg-[#6b4fd6]`
  const PRE =
    'm-0 overflow-x-auto rounded-md border border-[#252a34] bg-[#0f1115] px-2.5 py-2 text-[0.78rem] whitespace-pre-wrap break-all'
</script>

<svelte:head><title>Полный цикл модалки</title></svelte:head>

<!--
  Оформление страницы — утилиты, а не прежний блочный стиль: app.css хранит
  только токены тем. Тёмная тема спайка набрана цветами прямо в классах.
-->
<div class="min-h-dvh bg-[#0f1115] font-sans text-[15px] leading-[1.55] text-[#e6e8eb] [&_h1]:mb-1.5 [&_h1]:text-[1.6rem] [&_h2]:mb-3.5 [&_h2]:text-[0.78rem] [&_h2]:font-semibold [&_h2]:tracking-[0.08em] [&_h2]:text-[#8b93a1] [&_h2]:uppercase [&_dt]:text-[0.85rem] [&_dt]:text-[#8b93a1] [&_dd]:m-0">
  <main class="mx-auto max-w-[70rem] px-5 pt-8 pb-16">
    <h1>Полный цикл</h1>
    <p class="mb-7 max-w-[46rem] text-[#9aa3b2]">
      Объявление → вызов с параметрами → цепочка → адрес → Назад.
      Хост ещё не написан, поэтому слои ниже нарисованы примитивно —
      но сама механика настоящая.
    </p>

    <section class="grid grid-cols-1 gap-4 min-[820px]:grid-cols-2">
      <div class="mb-4 rounded-xl border border-[#252a34] bg-[#171a21] px-[1.2rem] py-[1.1rem]">
        <h2>Два поддерживаемых вида записи</h2>

        <div class="mb-[1.1rem] border-l-[3px] border-l-[#2d6cdf] py-0.5 pl-3">
          <div class="mb-1 text-[0.9rem]"><b>1. registered</b> · глобальный реестр</div>
          <p class="mb-2 text-[0.84rem] text-[#8b93a1]">Объявлена в <code class={CODE}>createRegistry('app')</code>, видна отовсюду.</p>
          <Button variant="plain" size="none" class={BTN} onclick={openGlobal} disabled={!ready}>Открыть «auth»</Button>
        </div>

        <div class="mb-[1.1rem] border-l-[3px] border-l-[#2d6cdf] py-0.5 pl-3">
          <div class="mb-1 text-[0.9rem]"><b>1. registered</b> · область роута</div>
          <p class="mb-2 text-[0.84rem] text-[#8b93a1]">Объявлена в <code class={CODE}>app.child('/cycle')</code>. С других роутов не видна.
             Параметры уезжают в адрес.</p>
          <Button variant="plain" size="none" class={BTN} onclick={openScoped} disabled={!ready}>Открыть «account» с id</Button>
        </div>

        <div class="mb-[1.1rem] border-l-[3px] border-l-[#6b4fd6] py-0.5 pl-3">
          <div class="mb-1 text-[0.9rem]"><b>3. transient</b> · слой из кода</div>
          <p class="mb-2 text-[0.84rem] text-[#8b93a1]">Имени в реестре нет, содержимое передаётся на месте,
             в адрес не попадает.</p>
          <Button variant="plain" size="none" class={BTN_ALT} onclick={openTransient} disabled={!ready}>Открыть разовый слой</Button>
        </div>

      </div>

      <div class="mb-4 rounded-xl border border-[#252a34] bg-[#171a21] px-[1.2rem] py-[1.1rem]">
        <h2>Что получилось</h2>
        <dl class="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt>стопка</dt>
          <dd class="font-semibold text-[#7ee787]">{chain.length ? chain.map(label).join(' → ') : 'пусто'}</dd>
          <dt>верхняя запись</dt>
          <dd>{top ? top.kind : '—'}</dd>
          <dt>её данные</dt>
          <dd><code>{top ? JSON.stringify(params(top)) : '—'}</code></dd>
          <dt>адрес</dt>
          <dd><code class={`${CODE} break-all`}>{href || '—'}</code></dd>
        </dl>

        <div class="flex gap-2">
          <Button variant="plain" size="none" class={BTN} onclick={close} disabled={!chain.length}>Закрыть верхнюю</Button>
          <Button variant="plain" size="none" class={BTN} onclick={closeAll} disabled={!chain.length}>Закрыть все</Button>
        </div>
        <p class="mt-2.5 text-[0.82rem] text-[#7a8292]">
          Дальше жмите <b>Назад</b> в браузере: каждое открытие — своя запись
          истории, у transient тоже. Затем <b>F5</b>: записи из адреса вернутся,
          разовый слой — нет.
        </p>
      </div>
    </section>

    <section class="mb-4 rounded-xl border border-[#252a34] bg-[#171a21] px-[1.2rem] py-[1.1rem]">
      <h2>Слои (заглушка вместо хоста)</h2>
      {#if chain.length === 0}
        <p class="mt-2.5 text-[0.82rem] text-[#7a8292]">Стопка пуста.</p>
      {:else}
        <div class="flex flex-col gap-2.5">
          {#each chain as entry, i (label(entry))}
            <div
              class="rounded-lg border border-[#252a34] p-3 opacity-50 data-[active]:border-[#2d6cdf] data-[active]:opacity-100"
              data-active={i === chain.length - 1 ? '' : undefined}
            >
              <div class="mb-1.5 flex flex-wrap items-center gap-2 text-[0.88rem]">
                <span class="rounded bg-[#2d6cdf] px-1.5 py-0.5 text-[0.7rem] data-[kind=transient]:bg-[#6b4fd6]" data-kind={entry.kind}>{entry.kind}</span>
                <b>{label(entry)}</b>
                <span class="ml-auto text-[0.78rem] text-[#7a8292]">глубина {i + 1} из {chain.length}</span>
              </div>
              <pre class={PRE}>{JSON.stringify(params(entry), null, 2)}</pre>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <section class="mb-4 rounded-xl border border-[#252a34] bg-[#171a21] px-[1.2rem] py-[1.1rem]">
      <h2>Журнал</h2>
      <pre class={`${PRE} max-h-48 overflow-y-auto`}>{log.join('\n') || '—'}</pre>
    </section>
  </main>
</div>

