<script lang="ts">
  /**
   * Конструктор полей — три шага: «Сборка» (набор полей), «Заполнение»
   * (запись на наборе) и «Результат» (просмотр). На каждом шаге — только его
   * действие; шаги сверху слева становятся ссылками, когда их уже заполняли.
   *
   * Шаг живёт в адресе (`?step=…`), поэтому шаги, «Вернуться» и переходы после
   * сохранения работают и без скрипта. Назад — форма прошлого шага в режиме
   * правки: она собирается из сохранённого набора и записи, а не с нуля.
   */
  import type { Result } from '#lib/form/index.js'
  import { Button } from '#lib/components/ui/index.js'
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

  /** Шаги сверху слева: ссылка — когда шаг заполнен, текст — пока нет. */
  const STEPS: readonly { key: FieldsStep; label: string }[] = [
    { key: 'build', label: 'Сборка' },
    { key: 'fill', label: 'Заполнение' },
    { key: 'result', label: 'Результат' },
  ]
  const filled = (key: FieldsStep): boolean => (key === 'build' ? !!data.set : !!data.record)
  const href = (key: FieldsStep) => `/fields?step=${key}`

  /** Кнопка «вернуться» — на каждом шаге, кроме первого. */
  const back = $derived(
    step === 'fill' ? { href: href('build'), label: 'Вернуться к сборке' }
      : step === 'result' ? { href: href('fill'), label: 'Вернуться к заполнению' }
      : null,
  )
</script>

<svelte:head>
  <title>Конструктор полей — modals-kit</title>
</svelte:head>

<div class="mx-auto w-full max-w-3xl space-y-6 py-8">
  <header class="space-y-2">
    <h1 class="text-3xl font-semibold tracking-tight">Конструктор полей</h1>
    <p class="text-muted-foreground">
      Соберите набор полей и правил к ним, сохраните — заполните запись на наборе и посмотрите результат.
    </p>
  </header>

  <!-- шаги сверху слева; на «Результате» справа от них — ссылка сброса -->
  <div class="flex items-baseline gap-4">
    <nav aria-label="Шаги" class="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
      {#each STEPS as s, i (s.key)}
        {#if i > 0}<span aria-hidden="true" class="text-muted-foreground">/</span>{/if}
        {#if filled(s.key)}
          <a
            href={href(s.key)}
            class="font-medium underline-offset-4 hover:underline"
            aria-current={step === s.key ? 'step' : undefined}
          >{s.label}</a>
        {:else}
          <span class="text-muted-foreground" aria-current={step === s.key ? 'step' : undefined}>{s.label}</span>
        {/if}
      {/each}
    </nav>
    {#if step === 'result'}
      <span class="ms-auto"><ResetAction /></span>
    {/if}
  </div>

  {#if step === 'build'}
    {#key data.set?.version ?? 0}
      <CollectionForm set={data.set} seed={seed('save')} />
    {/key}
  {:else if step === 'fill' && data.set}
    {#key `${data.set.version}:${data.record?.n ?? 0}`}
      <RecordForm set={data.set} previous={data.record} seed={seed('record')} />
    {/key}
  {:else if step === 'result' && data.record}
    <RecordView record={data.record} set={data.set} />
  {/if}

  {#if back}
    <p><Button href={back.href} variant="outline" size="sm">{back.label}</Button></p>
  {/if}
</div>
