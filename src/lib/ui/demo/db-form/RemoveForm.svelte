<script lang="ts">
  /**
   * Форма удаления — отдельный компонент по тому же правилу, что и
   * `CreateForm`: страница не собирает связку форм. id строк показывает
   * список, поэтому поле видимое и текстовое (значение можно скопировать).
   */
  import { untrack } from 'svelte'
  import { bind, Form } from '$lib/form/svelte'
  import type { Result } from '$lib/form'
  import { jsonTransport } from '$lib/ui/demo/form/transport'
  import { Button } from '$lib/ui/primitives'
  import { forms } from '$lib/ui/demo/form/forms.config'
  import Common from '$lib/ui/demo/form/ui/Common.svelte'
  import Field from '$lib/ui/demo/form/ui/Field.svelte'
  import { dbRemove } from './description'

  interface Props {
    /** Ответ экшена `?/remove` — continuation нативного пути (без JavaScript). */
    seed?: Result | null
    /**
     * Успешная запись: страница НЕ перезагружается, поэтому список обновляет
     * этот колбэк (он вызывает `reset` пагинатора — свежая страница из источника).
     */
    onApplied?: () => void
  }

  let { seed = null, onApplied }: Props = $props()

  // Путь отправки — штатный для `lib/form`: `intercept` по умолчанию = fetch через
  // транспорт конфига. Свой транспорт здесь нужен один-единственный: `/form/submit`
  // принимает форму демо форм, а не БД-демо. Нативный POST остаётся запасом без JS
  // (action `?/remove`), поэтому `seed`/continuation никуда не деваются.
  const form = bind(forms, dbRemove, {
    action: '?/remove',
    live: 'on-submit',
    transport: jsonTransport('/db-demo/submit'),
    continuation: untrack(() => seed),
  })

  // Реакция на итог — переход статуса в `success`, ровно один раз на отправку.
  // `submitCount` для этого не годится: поле объявлено в `FormState` (state.ts:15),
  // но ядром не увеличивается — эффект на нём не сработал бы вовсе. Первый запуск
  // эффекта не считается: `continuation` (путь без JS) тоже даёт `success`, а список
  // после перезагрузки и так свежий.
  let last = form.state.status
  $effect(() => {
    const now = form.state.status
    if (now === last) return
    const was = last
    last = now
    if (now === 'success' && was !== 'success') onApplied?.()
  })
</script>

<Form form={form} hiddenFields={form.hidden()} class="space-y-3 rounded-xl border border-border bg-card p-4">
  <Common errors={form.common} title="Удаление отклонено" />
  <Field of={form.f.ids} />
  <Button variant="outline" type="submit" data-testid="remove">Удалить</Button>
</Form>
