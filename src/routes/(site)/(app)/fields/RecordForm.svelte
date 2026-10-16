<script lang="ts">
  /**
   * Форма записи на сохранённом наборе: название, изображение и поля набора.
   * Описание то же, что поднимает сервер (`recordForm`), версия набора едет в
   * конверте — запись на устаревшем наборе сервер отклонит, а не примет молча.
   */
  import { untrack } from 'svelte'
  import { invalidateAll } from '$app/navigation'
  import { bind, Form, formTask } from '#lib/form/svelte/index.js'
  import type { Result } from '#lib/form/index.js'
  import { jsonTransport } from '#lib/components/form/transport.js'
  import { forms } from '#lib/components/form/forms.config.js'
  import { Button } from '#lib/components/ui/index.js'
  import Common from '#lib/components/form/Common.svelte'
  import Field from '#lib/components/form/Field.svelte'
  import { recordForm, type SavedSet } from './kit'

  let { set, seed = null }: { set: SavedSet; seed?: Result | null } = $props()

  const form = bind(forms, untrack(() => recordForm(set.specs)), {
    action: '?/record',
    live: 'on-submit',
    transport: jsonTransport('/fields/record'),
    continuation: untrack(() => seed),
    specVersion: untrack(() => set.version),
  })

  let last = form.state.status
  $effect(() => {
    const now = form.state.status
    if (now === last) return
    last = now
    if (now === 'success') void invalidateAll()
  })
</script>

<section class="space-y-3" aria-labelledby="fields-step-record">
  <div>
    <h2 id="fields-step-record" class="text-xl font-semibold">2. Запись на этом наборе</h2>
    <p class="text-sm text-muted-foreground">Хранится одна запись: новая отправка заменяет прежнюю.</p>
  </div>
  <Form id="fields-record" {form} hiddenFields={form.hidden()} class="space-y-3 rounded-xl border border-border bg-card p-4">
    <Common errors={form.common} title="Запись не сохранена" />
    <Field of={form.f.title} />
    <Field of={form.f.image} />
    {#each form.custom() as f (f.name)}<Field of={f} />{/each}
    <Button type="submit" data-testid="record-submit" task={formTask(form.state)}>Отправить</Button>
  </Form>
</section>
