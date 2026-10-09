<script lang="ts">
  // Выбор источников + кнопки, работающие только при нужном источнике.
  //
  // Этап B: панель живёт ПОД хостом корневого layout и читает живой
  // контекст (useModals) — смена источников пересобирает ядро, хост и
  // панель её переживают, {#key} больше не нужен. Источники — состояние
  // приложения (sources.svelte.ts): панель пишет прямо в него, layout
  // пересобирает ядро. Прежняя цена «панель вне хоста» (баг №26, журнал
  // §6 №11) снята: select панели на узком экране получает слой хоста.
import { Button } from '$lib/ui/primitives'
  import { onMount, untrack } from 'svelte'
  import { Select } from '$lib/ui'
  import { useModals } from '$lib/modals/svelte'
  import { demoSources } from './sources.svelte'

  const m = useModals()
  const active = $derived(demoSources.list)

  // 🔴 Носители меняются ПОЗЖЕ стора. Закрытие — это history.back():
  // адрес чистит асинхронный popstate, localStorage стирает reconcile
  // в его обработчике, а стор к тому моменту уже «равен» и сигнала нет.
  // Пересчёт только по view.chain замирал на значении ДО закрытия —
  // «url не чистится», «localStorage висит» (осмотр 1.10-2, №28/№29).
  // Поэтому перечитываем носители ещё и по факту смены адреса.
  // setTimeout(0): микрозадача ядра (notify → reconcile) успевает
  // стереть localStorage ДО перечитывания независимо от порядка
  // подписчиков popstate. storage — изменения из чужой вкладки.
  let carriers = $state(0)
  onMount(() => {
    const bump = () => setTimeout(() => (carriers += 1), 0)
    window.addEventListener('popstate', bump)
    window.addEventListener('storage', bump)
    return () => {
      window.removeEventListener('popstate', bump)
      window.removeEventListener('storage', bump)
    }
  })

  const SOURCES = [
    { value: 'url', label: 'url', hint: 'в адресе, переживает F5, делится ссылкой' },
    { value: 'local', label: 'localStorage', hint: 'адрес чистый, переживает F5' },
    { value: 'memory', label: 'memory', hint: 'ничего не переживает' },
  ]

  // `picked` — выбор пользователя в панели, а `active` лишь задаёт начальное значение;
  // дальше поток обратный — эффект ниже пишет `picked` в источники.
  let picked = $state<string[]>(untrack(() => [...active]))
  $effect(() => {
    // Хотя бы один источник обязателен: без него ядру некуда писать.
    // Единственный оставшийся пункт в списке заблокирован (см. options),
    // эта страховка — на случай программных изменений.
    if (picked.length === 0) return
    if (picked.join() !== demoSources.list.join()) demoSources.list = [...picked]
  })

  /** Последний выбранный источник снять нельзя — пункт гасится. */
  const options = $derived(
    SOURCES.map((s) => ({
      ...s,
      disabled: picked.length === 1 && picked[0] === s.value,
      hint:
        picked.length === 1 && picked[0] === s.value
          ? 'единственный источник — снять нельзя'
          : s.hint,
    })),
  )

  /** Что лежит в носителях прямо сейчас — обновляем на каждое изменение цепочки. */
  const storages = $derived.by(() => {
    void m.view.chain
    void carriers
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('modals:chain') : null
    return {
      url: typeof location !== 'undefined' ? location.search || '—' : '—',
      local: raw ?? '—',
    }
  })

  /**
   * Сколько записей держит каждый источник. Считаем по ЧТЕНИЮ ЯДРА
   * (`core.read()` раскладывает по источникам и проставляет `source`),
   * а не по стору: в сторе у записи, открытой без явного `source`,
   * этого поля нет — его ставит только раскладка в core.write, поэтому
   * фильтр по стору показывал «0 записей» при честно открытой модалке
   * (осмотр 1.10-2, №27).
   */
  const held = $derived.by(() => {
    void m.view.chain
    void carriers
    const counts: Record<string, number> = {}
    for (const e of m.modals.core.read()) {
      if (e.kind === 'registered' && e.source) counts[e.source] = (counts[e.source] ?? 0) + 1
    }
    return counts
  })

  const has = (s: string) => active.includes(s)
</script>

<section class="my-6 rounded-[12px] border border-border px-4 py-[1.1rem] [&_h2]:m-0 [&_h2]:mb-2 [&_h2]:text-[0.8rem] [&_h2]:font-semibold [&_h2]:uppercase [&_h2]:tracking-[0.06em] [&_h2]:text-muted-foreground">
  <h2>Источники</h2>
  <p class="my-2 text-[0.82rem] text-muted-foreground">
    Ядро собирается как <code>модалка(ядро(хранилище), опции)</code>.
    Снимите источник — кнопки, которым он нужен, погаснут.
  </p>

  <div class="mb-3 max-w-[26rem]">
    <Select {options} bind:value={picked} multiple placeholder="Выберите источники" />
  </div>

  <div class="flex flex-wrap gap-2">
    <Button variant="plain" size="none" class="cursor-pointer rounded-lg bg-primary px-3 py-2 text-[0.88rem] text-primary-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground" disabled={!has('url')} onclick={() => m.modals.open('card', { params: { id: 1 }, source: 'url' })}>
      Открыть в url
    </Button>
    <Button variant="plain" size="none" class="cursor-pointer rounded-lg bg-primary px-3 py-2 text-[0.88rem] text-primary-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground" disabled={!has('local')} onclick={() => m.modals.open('card', { params: { id: 2 }, source: 'local' })}>
      Открыть в localStorage
    </Button>
    <Button variant="plain" size="none" class="cursor-pointer rounded-lg bg-primary px-3 py-2 text-[0.88rem] text-primary-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground" disabled={!has('memory')} onclick={() => m.modals.open('card', { params: { id: 3 }, source: 'memory' })}>
      Открыть в memory
    </Button>
  </div>

  <dl class="mt-3.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.82rem] [&_dd]:m-0 [&_dt]:text-muted-foreground">
    <dt>адрес</dt><dd><code>{storages.url}</code></dd>
    <dt>localStorage</dt><dd><code>{storages.local}</code></dd>
    <dt>memory</dt><dd><code>{held.memory ?? 0} записей</code></dd>
  </dl>

  <p class="my-2 text-[0.82rem] text-muted-foreground">
    Сценарий: откройте в localStorage и в memory, затем <b>F5</b>.
    Запись localStorage восстановится, memory — нет: она живёт в памяти вкладки.
    Закрытие модалки стирает запись из её носителя.
  </p>
</section>

