<script lang="ts">
  /**
   * Форма правки заголовка — та же связка, что у удаления: страница отдаёт
   * результат экшена, список правит окно по `updated` из ответа. Без неё
   * `updated_at` в демо не меняется ни у кого, и опрос изменённых
   * (`docs/design/live-update.md` §5.2) нечем проверить вживую.
   */
  import { untrack } from 'svelte'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import type { Result } from '#lib/form/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { Button } from '#components/ui/index.js'
  import { forms } from '#components/form/forms.config.js'
  import Common from '#components/form/Common.svelte'
  import Field from '#components/form/Field.svelte'
  import { dbRename } from './description'
  import type { DbPost } from '#content/demo-catalog/posts/source.js'

  interface Props {
    /** Ответ нативного POST (конверт `__form_id`) — continuation пути без JavaScript. */
    seed?: Result | null
    /**
     * Успешная правка: страница НЕ перезагружается, поэтому список обновляет
     * этот колбэк — по обновлённой строке из ответа.
     */
    onApplied?: (row: DbPost | null) => void
  }

  let { seed = null, onApplied }: Props = $props()

  // Путь отправки — штатный для `lib/form`: `intercept` по умолчанию = fetch через
  // транспорт связки. У `forms.config.ts` транспорта по умолчанию НЕТ (адрес — свойство
  // формы), поэтому `bindComponentForm` берёт адрес текущей страницы и конверт
  // `__form_id`; нативный POST тем же адресом остаётся путём без JS, и
  // `seed`/continuation никуда не деваются.
  const form = bindComponentForm(forms, dbRename, {
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
      const updated = (form.state.result?.data as { updated?: DbPost | null } | undefined)?.updated
      onApplied?.(updated ?? null)
    }
  })
</script>

<Form form={form} hiddenFields={form.hidden()} class="space-y-3 rounded-xl border border-border bg-card p-4">
  <Common errors={form.common} title="Правка отклонена" />
  <Field of={form.f.id} />
  <Field of={form.f.title} />
  <Button variant="outline" type="submit" data-testid="rename" task={formTask(form.state)}>Переименовать</Button>
</Form>
