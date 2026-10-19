<script lang="ts">
  /**
   * Форма набора: одно поле `field.fields`. Места под поля расставляет разметка
   * приложения (`SchemaBuilder`), пределы проверяет форма.
   */
  import { untrack } from 'svelte'
  import { goto } from '$app/navigation'
  import { visibleAddress, writeAddress } from '#lib/address/sveltekit.js'
  import { bind, Form, formTask } from '#lib/form/svelte/index.js'
  import type { Result } from '#lib/form/index.js'
  import { jsonTransport } from '#lib/components/form/transport.js'
  import { forms } from '#lib/components/form/forms.config.js'
  import { Button } from '#lib/components/ui/index.js'
  import Common from '#lib/components/form/Common.svelte'
  import SchemaBuilder from './SchemaBuilder.svelte'
  import { collectionForm, demoQuery, type SavedSet } from './forms'

  let {
    set,
    seed = null,
    /** Демо-предел набора из адреса: описание формы строится под него (как на сервере). */
    limit,
    /** Куда идти после сохранения набора — следующий шаг. */
    next = '/fields?step=fill',
  }: { set: SavedSet | null; seed?: Result | null; limit: number; next?: string } = $props()

  // Опции демо едут с отправкой: сервер обязан проверить набор ТЕМ ЖЕ пределом,
  // а нативный экшен (`?/save`) затирает строку запроса — поэтому ключ стоит
  // рядом с именем экшена (`?limit=4&/save`), а не в адресе страницы.
  // Предел меняется только полной навигацией — компонент пересоздаётся целиком.
  // svelte-ignore state_referenced_locally
  const q = demoQuery(limit)
  // Тот же предел — в адресе следующего шага: клиентский переход идёт мимо сервера.
  // `next` — адрес на монтировании, как и сама форма.
  // svelte-ignore state_referenced_locally
  const nextHref = q ? `${next}${next.includes('?') ? '&' : '?'}${q}` : next

  // Сохранённый набор — начальное значение поля; набранное (и ответ без JS) сильнее.
  const form = bind(forms, untrack(() => collectionForm(set?.fields, limit)), {
    action: q ? `?${q}&/save` : '?/save',
    live: 'on-submit',
    transport: jsonTransport(`/fields/save${q ? `?${q}` : ''}`),
    continuation: untrack(() => seed),
  })

  // Успех НАСТОЯЩЕГО сохранения уводит на следующий шаг: один `goto`, без
  // `invalidateAll` рядом — два запуска загрузки наперегонки возвращаются в
  // непредсказуемом порядке и оставляют страницу на прежних данных, `goto`
  // перезапускает загрузку сам. Ответ кнопок мест (`not-applied`) тоже
  // «успех», но переход не он — смотрим на исход.
  let last = form.state.status
  $effect(() => {
    const now = form.state.status
    if (now === last) return
    last = now
    if (now === 'success' && form.state.outcome !== 'not-applied') void goto(nextHref)
  })
  // Пока идёт отправка, шаги не кликаются. Замок живёт в состоянии ЗАПИСИ
  // истории (`page.state`, уровень роутера), а не в общем модуле: у каждого
  // шага свой, «назад/вперёд» чужой замок не снимает и не наследует.
  $effect(() => {
    const pending = form.state.pending
    const here = visibleAddress()
    if (!!here.state.fieldsNavLocked !== pending)
      // Замок — состояние записи истории; пишет общий писатель адреса, не свой
      // `replaceState` (вторая запись обгоняет очередь и теряет чужие состояния).
      void writeAddress(
        () => ({ url: here.url.href, state: { ...here.state, fieldsNavLocked: pending } }),
        { replace: true, load: false },
      )
  })
</script>

<section class="space-y-3" aria-labelledby="fields-step-builder">
  <h2 id="fields-step-builder" class="text-xl font-semibold">Создание полей</h2>
  <Form id="fields-builder" {form} hiddenFields={form.hidden()} class="space-y-3 rounded-xl border border-border bg-card p-4">
    <!-- Enter в поле без JS нажимает ПЕРВУЮ кнопку отправки: ею должна быть «Сохранить»,
         а не «Удалить» первого места. Скрытая копия — первая. -->
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
