<script lang="ts">
  /**
   * Форма набора: одно поле `field.fields`. Места под поля расставляет разметка
   * приложения (`SchemaBuilder`), пределы проверяет форма.
   */
  import { untrack } from 'svelte'
  import { invalidateAll } from '$app/navigation'
  import { bind, Form, formTask } from '#lib/form/svelte/index.js'
  import type { Result } from '#lib/form/index.js'
  import { jsonTransport } from '#lib/components/form/transport.js'
  import { forms } from '#lib/components/form/forms.config.js'
  import { Button } from '#lib/components/ui/index.js'
  import Common from '#lib/components/form/Common.svelte'
  import SchemaBuilder from './SchemaBuilder.svelte'
  import { collectionForm, type SavedSet } from './forms'

  let { set, seed = null }: { set: SavedSet | null; seed?: Result | null } = $props()

  // Сохранённый набор — начальное значение поля; набранное (и ответ без JS) сильнее.
  const form = bind(forms, untrack(() => collectionForm(set?.fields)), {
    action: '?/save',
    live: 'on-submit',
    transport: jsonTransport('/fields/save'),
    continuation: untrack(() => seed),
  })

  // Успех: набор лёг в кэш — страница перечитывает данные, форма пересобирается
  // из сохранённого (с поправками пределов), появляется форма записи.
  let last = form.state.status
  $effect(() => {
    const now = form.state.status
    if (now === last) return
    last = now
    if (now === 'success') void invalidateAll()
  })
</script>

<section class="space-y-3" aria-labelledby="fields-step-builder">
  <h2 id="fields-step-builder" class="text-xl font-semibold">1. Набор полей</h2>
  <Form id="fields-builder" {form} hiddenFields={form.hidden()} class="space-y-3 rounded-xl border border-border bg-card p-4">
    <!-- Enter в поле без JS нажимает ПЕРВУЮ кнопку отправки: ею должна быть «Сохранить»,
         а не «Удалить» первого места. Скрытая копия — первая; с JS кнопки мест — type="button". -->
    <button type="submit" hidden tabindex="-1" aria-hidden="true"></button>
    <Common errors={form.common} title="Набор не сохранён" />
    <SchemaBuilder {form} name="props" />
    <Button type="submit" data-testid="save" {...form.intent('submit')} task={formTask(form.state)}>Сохранить</Button>
  </Form>

  {#if set}
    <p class="rounded-lg border border-border p-3 text-sm" data-testid="saved-set">
      Набор сохранён (версия {set.version}), полей: {set.fields.length}.
    </p>
  {/if}
</section>
