<script lang="ts">
  /**
   * Конструктор полей — три шага: «Сборка» (набор полей), «Заполнение»
   * (запись на наборе) и «Результат» (просмотр). На каждом шаге — только его
   * действие; шаги сверху слева становятся ссылками, когда их уже заполняли.
   *
   * Шаг живёт в адресе (`?step=…`), поэтому навигация по шагам и переходы
   * после сохранения работают и без скрипта. Назад — форма прошлого шага в
   * режиме правки: она собирается из сохранённого набора и записи, а не с нуля.
   */
  import { Steps, useSteps } from '#lib/components/steps/index.js'
  import { DemoPanel } from '#lib/components/demo/index.js'
  import { demoPanelSchema } from './demo-schema.ts'
  import type { Result } from '#lib/form/index.js'
  import CollectionForm from './CollectionForm.svelte'
  import RecordForm from './RecordForm.svelte'
  import RecordView from './RecordView.svelte'
  import ResetAction from './ResetAction.svelte'
  import type { FieldsStep } from './forms'
  import type { PageData } from './$types'

  let {
    data,
    form: action,
  }: {
    data: PageData
    form?: { result?: Result; intent?: string; step?: FieldsStep } | null
  } = $props()

  // шаг из ответа экшена (отказ и намерения вернулись на свой шаг) или из адреса
  const step = $derived(action?.step ?? data.step)

  // Ответ экшена без JavaScript. Успех не сеется: форма собирается из сохранённого,
  // с поправками набора, а не из того, что было набрано.
  const seed = (intent: string) =>
    action?.intent === intent && action.result && (!action.result.ok || action.result.outcome === 'not-applied')
      ? action.result : null

  /**
   * Шаги — компонент над бронью адреса: хост бронирует `step` (чужие ключи
   * адреса — цепочка модалок, страница пагинатора — не теряются), строит
   * ссылки, показывает замок полёта. Сам замок пишет форма в состояние ЗАПИСИ
   * истории (`page.state`): у каждой записи свой, «назад/вперёд» чужой не
   * снимает. Заполненность шага знает страница — у неё данные.
   */
  /** Шаги сверху слева: ссылка — когда шаг заполнен, текст — пока нет. */
  const STEPS: readonly { key: FieldsStep; label: string }[] = [
    { key: 'build', label: 'Сборка' },
    { key: 'fill', label: 'Заполнение' },
    { key: 'result', label: 'Результат' },
  ]
  const filled = (key: FieldsStep): boolean => (key === 'build' ? !!data.set : !!data.record)
  const steps = useSteps({
    owner: 'fields',
    mode: 'url',
    steps: () => STEPS.map((s) => ({ ...s, filled: filled(s.key) })),
    current: () => step,
    lockKey: 'fieldsNavLocked',
  })
</script>

<svelte:head>
  <title>Конструктор полей — modals-kit</title>
</svelte:head>

<div class="mx-auto w-full max-w-3xl space-y-6">
  <header class="space-y-2">
    <h1 class="text-3xl font-semibold tracking-tight">Конструктор полей</h1>
    <p class="text-muted-foreground">
      Соберите набор полей и правил к ним, сохраните — заполните запись на наборе и посмотрите результат.
    </p>
  </header>

  <!-- Демо-панель: опция живёт в адресе (`?limit=`), значение читают обе стороны
       — страница строит по нему описание формы, сервер — приёмник запроса. -->
  <DemoPanel schema={demoPanelSchema} />

  <!-- шаги сверху слева; на «Результате» справа от них — ссылка сброса -->
  <div class="flex items-baseline gap-4">
    <span><Steps host={steps} label="Шаги" /></span>
    {#if step !== 'build'}
      <span class="ms-auto"><ResetAction /></span>
    {/if}
  </div>

  <!-- логика каждого шага — свой сниппет компонента (без второй навигации) -->
  <Steps host={steps} label="" nav={false}>
    {#snippet build()}
      <!-- Ключ — ещё и предел: описание формы строится один раз на монтировании,
           а смена опции меняет его состав (max набора). -->
      {#key `${data.set?.version ?? 0}:${data.limit}`}
        <CollectionForm set={data.set} seed={seed('save')} limit={data.limit} />
      {/key}
    {/snippet}
    {#snippet fill()}
      {#if data.set}
        {#key `${data.set.version}:${data.record?.n ?? 0}`}
          <RecordForm set={data.set} previous={data.record} seed={seed('record')} />
        {/key}
      {/if}
    {/snippet}
    {#snippet result()}
      {#if data.record}
        <RecordView record={data.record} set={data.set} />
      {/if}
    {/snippet}
  </Steps>
</div>
