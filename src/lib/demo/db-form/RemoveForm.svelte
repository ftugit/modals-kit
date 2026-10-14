<script lang="ts">
  /**
   * Форма удаления — отдельный компонент по тому же правилу, что и
   * `CreateForm`: страница не собирает связку форм. id строк показывает
   * список, поэтому поле видимое и текстовое (значение можно скопировать).
   */
  import { untrack } from 'svelte'
  import { bind, Form } from '#lib/form/svelte/index.js'
  import type { Result } from '#lib/form/index.js'
  import { jsonTransport } from '#lib/demo/form/transport.js'
  import { Button } from '#lib/components/ui/index.js'
  import { forms } from '#lib/demo/form/forms.config.js'
  import Common from '#lib/demo/form/ui/Common.svelte'
  import Field from '#lib/demo/form/ui/Field.svelte'
  import { dbRemove } from './description'

  interface Props {
    /** Ответ экшена `?/remove` — continuation нативного пути (без JavaScript). */
    seed?: Result | null
    /**
     * Успешная запись: страница НЕ перезагружается, поэтому список обновляет
     * этот колбэк — по `id` удалённых строк из ответа.
     */
    onApplied?: (removed: readonly string[]) => void
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
  // `submitCount` для этого не годится: привязка увеличивает его в НАЧАЛЕ отправки
  // (`bind.svelte.ts`, `submit`), а не по итогу, и путь без JS его не трогает. Первый запуск
  // эффекта не считается: `continuation` (путь без JS) тоже даёт `success`, а список
  // после перезагрузки и так свежий.
  let last = form.state.status
  $effect(() => {
    const now = form.state.status
    if (now === last) return
    const was = last
    last = now
    if (now === 'success' && was !== 'success') {
      const removed = (form.state.result?.data as { removed?: string[] } | undefined)?.removed
      onApplied?.(removed ?? [])
    }
  })
</script>

<Form form={form} hiddenFields={form.hidden()} class="space-y-3 rounded-xl border border-border bg-card p-4">
  <Common errors={form.common} title="Удаление отклонено" />
  <Field of={form.f.ids} />
  <Button variant="outline" type="submit" data-testid="remove">Удалить</Button>
</Form>
