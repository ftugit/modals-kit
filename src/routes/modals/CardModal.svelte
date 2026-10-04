<script lang="ts">
  // Порт CardModal из src/features/modals/demo-modals.tsx оригинала.
  // Состав 1:1: заголовок из загрузчика, индекс/id/глубина, цепочка,
  // «следующая» карточка (случайные размер и цвет, стабильные пока
  // запись в цепочке), обмен данными между слоями, футер с триггерами.
  import { useChain, useLoader, useModal, useModalData, useSharedData, useModals } from '$lib/modals/svelte'
  import { ModalTrigger } from '$lib/modals/svelte'
  import { entryLabel } from '$lib/modals'
  import { CloseAllButton } from '$lib/ui/modals'
  import { Select } from '$lib/ui'
  import FloatingMenu from './FloatingMenu.svelte'

  let {
    index,
  }: {
    index: number
  } = $props()

  const m = useModals()
  const me = useModal<{ id?: number; slow?: boolean }>()
  const chain = useChain()
  const ldr = useLoader<{ title: string; body: string }>()
  const mine = useModalData<string>()
  const shared = useSharedData()

  const PALETTE = [
    'var(--card)',
    'color-mix(in oklab, var(--chart-1) 8%, var(--card))',
    'color-mix(in oklab, var(--chart-2) 8%, var(--card))',
    'color-mix(in oklab, var(--chart-3) 8%, var(--card))',
    'color-mix(in oklab, var(--chart-4) 8%, var(--card))',
    'color-mix(in oklab, var(--chart-5) 8%, var(--card))',
  ]
  const TAILS = [
    'var(--border)',
    'color-mix(in oklab, var(--chart-1) 22%, var(--border))',
    'color-mix(in oklab, var(--chart-2) 22%, var(--border))',
    'color-mix(in oklab, var(--chart-3) 22%, var(--border))',
    'color-mix(in oklab, var(--chart-4) 22%, var(--border))',
    'color-mix(in oklab, var(--chart-5) 22%, var(--border))',
  ]

  function randomSize(): { width: number; height: number } {
    const w = 360 + Math.round(Math.random() * 4) * 90
    const h = 260 + Math.round(Math.random() * 3) * 80
    return { width: w, height: h }
  }

  // следующая модалка: случайные размер, цвет и иногда загрузчик
  // (зависит от index — стабильна пока запись в цепочке, как в оригинале)
  /* Демонстрация внутри карточки: оба host-owned оверлея на одной сцене. */
  const PRIORITIES = [
    { value: 'low', label: 'Низкий' },
    { value: 'normal', label: 'Обычный', hint: 'по умолчанию' },
    { value: 'high', label: 'Высокий' },
    { value: 'urgent', label: 'Срочный', disabled: true },
  ]
  let priority = $state('normal')
  let lastAction = $state('—')

  const next = $derived.by(() => {
    void index
    const i = Math.floor(Math.random() * PALETTE.length)
    return {
      size: randomSize(),
      color: PALETTE[i],
      tailColor: TAILS[i],
      slow: Math.random() > 0.5,
      id: Math.floor(Math.random() * 900) + 100,
    }
  })
</script>

<div class="flex min-h-0 flex-auto flex-col">
  <div class="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
    <div>
      <div class="text-base font-semibold tracking-tight">
        {ldr.data?.title ?? `Карточка №${me.index + 1}`}
      </div>
      <div class="text-xs text-muted-foreground">
        id: {String(me.params.id ?? '—')} · в стопке {me.index + 1} из {me.depth} ·
        {ldr.loading ? 'загрузка…' : 'готово'}
      </div>
    </div>
    <button
      type="button"
      class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      onclick={() => m.modals.close()}
      aria-label="Закрыть текущую"
    >
      ✕
    </button>
  </div>

  <div class="min-h-0 flex-auto overflow-y-auto px-5 py-4 text-sm leading-relaxed text-muted-foreground">
    <p>
      {ldr.data?.body ??
        'Модалка вызывает саму себя: каждая новая уводит текущую в стопку и оставляет хвост.'}
    </p>

    <div class="mt-3 rounded-lg bg-muted p-3 font-mono text-xs text-foreground">
      <div>
        цепочка:
        {chain.current.map((c) => entryLabel(c)).join(' → ')}
      </div>
      <div>
        следующая: {next.size.width}×{next.size.height} ·
        <span style:color={next.tailColor}>■</span> ·
        {next.slow ? 'с загрузчиком' : 'без загрузчика'}
      </div>
    </div>

    <div class="mt-3 flex flex-wrap items-end gap-3">
      <label class="flex min-w-[12rem] flex-auto flex-col gap-1 text-xs font-medium text-muted-foreground">
        Приоритет — select внутри карточки
        <Select options={PRIORITIES} bind:value={priority} placeholder="Выберите приоритет" />
      </label>
      <div class="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Без мобильного режима
        <FloatingMenu
          label="Всегда выпадашка"
          sheetOnNarrow={false}
          items={[
            { label: 'Этот оверлей не прижимается', hint: 'sheetOnNarrow=false' },
            { label: 'Закрыть эту модалку', onSelect: () => m.modals.close() },
          ]}
        />
      </div>
      <div class="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Меню карточки
        <FloatingMenu
          label="Действия"
          items={[
            { label: 'Отметить важным', hint: priority, onSelect: () => (lastAction = 'важное') },
            { label: 'Открыть ещё карточку', onSelect: () => m.modals.open('card', { params: { id: next.id } }) },
            { label: 'Полноэкранная', onSelect: () => m.modals.open('fullpage') },
            { label: 'Недоступно', disabled: true },
            { label: 'Закрыть эту', onSelect: () => m.modals.close() },
          ]}
        />
      </div>
      <div class="text-xs text-muted-foreground">
        приоритет: <b class="font-mono">{priority}</b> · действие: <b class="font-mono">{lastAction}</b>
      </div>
    </div>

    <div class="mt-3">
      <div class="mb-1 text-xs font-medium text-muted-foreground">
        Обмен данными (§9): напиши — увидят соседние модалки
      </div>
      <input
        class="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm"
        value={mine.value ?? ''}
        oninput={(e) => (mine.value = e.currentTarget.value)}
        placeholder="сообщение для соседей"
      />
      <div class="mt-2 space-y-0.5 text-xs text-muted-foreground">
        {#each Object.entries(shared.value) as [key, value] (key)}
          <div>
            <b class="font-mono">{key}</b>: {String(value)}
          </div>
        {/each}
      </div>
    </div>
  </div>

  <div class="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
    <!-- Прижатие не копируем в override: дочерняя запись получает текущую
         политику хоста и при необходимости наследует якорь снизу в Host. -->
    <ModalTrigger
      name="card"
      params={{ id: next.id, slow: next.slow }}
      size={next.size}
      color={next.color}
      tailColor={next.tailColor}
    >
      Открыть ещё одну
    </ModalTrigger>
    <ModalTrigger
      name="card"
      params={{ id: next.id }}
      noForward
      title="Закроется — «Вперёд» её уже не вернёт"
    >
      Без «Вперёд»
    </ModalTrigger>
    <ModalTrigger name="fullpage">
      Полноэкранная
    </ModalTrigger>
    <ModalTrigger name="ghost">
      Несуществующая
    </ModalTrigger>
    <CloseAllButton />
    <ModalTrigger name="locked">
      Заблокированная
    </ModalTrigger>
    <!-- Режимы стопки — опция порта `stack` (§6 №9), в демо оригинала
         их нет. Цель — fullpage: у неё нет route, поэтому в href ВИДНО,
         как перестраивается адрес. Стоишь в card,card,card:
           «С новой стопкой»  → href и клик ведут на ?modal=fullpage
           «В начало стопки»  → ?modal=card,fullpage (первая осталась) -->
    <ModalTrigger name="fullpage" stack="new">
      С новой стопкой
    </ModalTrigger>
    <ModalTrigger name="fullpage" stack="first">
      В начало стопки
    </ModalTrigger>
    <!-- Модалка без хранилища поверх этой: transient-запись ложится на
         вершину цепочки, в адрес не попадает. -->
    <button
      type="button"
      class="modal-trigger"
      onclick={() => m.modals.openLayer({ content: storagelessInCard })}
    >
      Без хранилища поверх
    </button>
  </div>
</div>

<!-- Содержимое transient-модалки, открываемой из карточки. -->
{#snippet storagelessInCard()}
  <div class="flex flex-col gap-3 p-5">
    <h2 class="m-0 text-lg">Модалка без хранилища</h2>
    <p class="m-0 text-sm text-muted-foreground">
      Открыта поверх карточки. Это transient-запись: в адресе её нет, перезагрузку
      она не переживёт, но «Назад» закрывает именно её.
    </p>
    <div class="flex flex-wrap items-center gap-2">
      <FloatingMenu
        label="Меню этой модалки"
        items={[
          { label: 'Закрыть её', onSelect: () => m.modals.close() },
          { label: 'Закрыть всё', onSelect: () => m.modals.closeAll() },
        ]}
      />
      <button
        type="button"
        class="modal-trigger"
        onclick={() => m.modals.open('select', { stack: 'new' })}
      >
        Перейти на демо-модалку
      </button>
    </div>
  </div>
{/snippet}
