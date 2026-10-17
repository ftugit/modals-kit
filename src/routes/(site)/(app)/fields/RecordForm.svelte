<script lang="ts">
  /**
   * Форма записи на сохранённом наборе: поля набора, название и изображение.
   * Описание то же, что строит сервер (`recordForm` — `defineForm({ from })`):
   * запись на устаревшем наборе сервер отклонит, а не примет молча.
   */
  import { untrack } from 'svelte'
  import { goto, replaceState } from '$app/navigation'
  import { page } from '$app/state'
  import { bind, Form, formTask } from '#lib/form/svelte/index.js'
  import type { Result } from '#lib/form/index.js'
  import { jsonTransport } from '#lib/components/form/transport.js'
  import { forms } from '#lib/components/form/forms.config.js'
  import { Button } from '#lib/components/ui/index.js'
  import Common from '#lib/components/form/Common.svelte'
  import Field from '#lib/components/form/Field.svelte'
  import SchemaFields from './SchemaFields.svelte'
  import { recordForm, type SavedRecord, type SavedSet } from './forms'

  let {
    set,
    previous = null,
    seed = null,
    /** Куда идти после отправки записи — следующий шаг. */
    next = '/fields?step=result',
  }: { set: SavedSet; previous?: SavedRecord | null; seed?: Result | null; next?: string } = $props()

  // режим правки: прежние значения возвращаются в поля (файлы браузер назад не отдаёт)
  const form = bind(forms, untrack(() => recordForm(set, previous)), {
    action: '?/record',
    live: 'on-submit',
    transport: jsonTransport('/fields/record'),
    continuation: untrack(() => seed),
  })

  // тот же принцип, что в сборке: один `goto` после настоящего успеха
  // (`not-applied` тоже «успех», но переход не он), замок — в `page.state`
  let last = form.state.status
  $effect(() => {
    const now = form.state.status
    if (now === last) return
    last = now
    if (now === 'success' && form.state.outcome !== 'not-applied') void goto(next)
  })
  $effect(() => {
    const pending = form.state.pending
    if (!!page.state.fieldsNavLocked !== pending)
      void replaceState(page.url.href, { ...page.state, fieldsNavLocked: pending })
  })
</script>

<section class="space-y-3" aria-labelledby="fields-step-record">
  <div>
    <h2 id="fields-step-record" class="text-xl font-semibold">Заполнение</h2>
    <p class="text-sm text-muted-foreground">Хранится одна запись: новая отправка заменяет прежнюю.</p>
  </div>
  <Form id="fields-record" {form} hiddenFields={form.hidden()} class="space-y-3 rounded-xl border border-border bg-card p-4">
    <Common errors={form.common} title="Запись не сохранена" />
    <SchemaFields {form} />
    <Field of={form.f.title} />
    {#if previous?.image}
      <!-- прежнее изображение: браузер файл назад не отдаёт, показываем его здесь -->
      <figure class="space-y-1">
        <img src={previous.image} alt={previous.title} class="h-16 rounded-md border border-border" />
        <figcaption class="text-xs text-muted-foreground">Текущее изображение</figcaption>
      </figure>
    {/if}
    <Field of={form.f.image} />
    <Button type="submit" data-testid="record-submit" task={formTask(form.state)}>Отправить</Button>
  </Form>
</section>
