<script lang="ts">
  /**
   * Форма удаления — отдельный компонент по тому же правилу, что и
   * `CreateForm`: страница не собирает связку форм. id строк показывает
   * список, поэтому поле видимое и текстовое (значение можно скопировать).
   */
  import { untrack } from 'svelte'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import type { Result } from '#lib/form/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { Button } from '#components/ui/index.js'
  import { forms } from '#components/form/forms.config.js'
  import Common from '#components/form/Common.svelte'
  import Field from '#components/form/Field.svelte'
  import { dbRemove } from './description'

  interface Props {
    /** Ответ нативного POST (конверт `__form_id`) — continuation пути без JavaScript. */
    seed?: Result | null
    /**
     * Успешная запись: страница НЕ перезагружается, поэтому список обновляет
     * этот колбэк — по `id` удалённых строк из ответа.
     */
    onApplied?: (removed: readonly string[]) => void
  }

  let { seed = null, onApplied }: Props = $props()

  // Путь отправки — штатный для `lib/form`: `intercept` по умолчанию = fetch через
  // транспорт связки. У `forms.config.ts` транспорта по умолчанию НЕТ (адрес — свойство
  // формы), поэтому `bindComponentForm` берёт адрес текущей страницы и конверт
  // `__form_id`; нативный POST тем же адресом остаётся путём без JS, и
  // `seed`/continuation никуда не деваются.
  const form = bindComponentForm(forms, dbRemove, {
    live: 'on-submit',
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

<Form form={form} hiddenFields={form.hidden()} class="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm">
  <Common errors={form.common} title="Удаление отклонено" />
  <Field of={form.f.ids} />
  <Button variant="outline" type="submit" data-testid="remove" task={formTask(form.state)}>Удалить</Button>
</Form>
