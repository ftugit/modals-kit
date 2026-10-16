<script lang="ts">
  // Конструктор полей: форма с полем `field.fields` → форма записи на сохранённом
  // наборе (`defineForm({ from })`) → пример записи. Набор и запись живут в кэше
  // процесса (`#lib/cache`), по одному.
  import type { Result } from '#lib/form/index.js'
  import CollectionForm from './CollectionForm.svelte'
  import RecordForm from './RecordForm.svelte'
  import RecordView from './RecordView.svelte'
  import type { PageData } from './$types'

  let { data, form: action }: { data: PageData; form?: { result?: Result; intent?: string } | null } = $props()

  // Ответ экшена без JavaScript. Успех не сеется: форма собирается из сохранённого,
  // с поправками набора, а не из того, что было набрано.
  const seed = (intent: string) =>
    action?.intent === intent && action.result && (!action.result.ok || action.result.outcome === 'not-applied')
      ? action.result : null
</script>

<svelte:head>
  <title>Конструктор полей — modals-kit</title>
</svelte:head>

<div class="mx-auto w-full max-w-3xl space-y-8 py-8">
  <header class="space-y-2">
    <h1 class="text-3xl font-semibold tracking-tight">Конструктор полей</h1>
    <p class="text-muted-foreground">
      Соберите набор полей и правил к ним, сохраните — ниже появится форма записи на этом наборе.
    </p>
  </header>

  {#key data.set?.version ?? 0}
    <CollectionForm set={data.set} seed={seed('save')} />
  {/key}

  {#if data.set}
    {#key `${data.set.version}:${data.record?.n ?? 0}`}
      <RecordForm set={data.set} seed={seed('record')} />
    {/key}
  {/if}

  {#if data.record}<RecordView record={data.record} set={data.set} />{/if}
</div>
