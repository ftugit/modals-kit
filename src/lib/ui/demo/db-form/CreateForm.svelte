<script lang="ts">
  /**
   * Форма добавления записи — отдельный компонент, как и остальные формы демо
   * (`src/lib/ui/demo/form/*`): связка `bind` + `Form` + `Common`/`Field`
   * живёт здесь, страница передаёт только результат экшена.
   *
   * Отправка идёт нативным `form`-путём (action `?/create`), потому что слой
   * `lib/form` держит origin, лимит тела, имена и валидацию; собственный
   * `fetch` в обход него здесь запрещён сборкой (`npm run test:guard`).
   */
  import { untrack } from 'svelte'
  import { bind, Form } from '$lib/form/svelte'
  import type { Result } from '$lib/form'
  import { jsonTransport } from '$lib/ui/demo/form/transport'
  import { Button } from '$lib/ui/primitives'
  import { forms } from '$lib/ui/demo/form/forms.config'
  import Common from '$lib/ui/demo/form/ui/Common.svelte'
  import Field from '$lib/ui/demo/form/ui/Field.svelte'
  import { dbCreate } from './description'

  interface Props {
    /** Ответ экшена `?/create` — continuation нативного пути (без JavaScript). */
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
  // (action `?/create`), поэтому `seed`/continuation никуда не деваются.
  const form = bind(forms, dbCreate, {
    action: '?/create',
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
  <Common errors={form.common} title="Добавление отклонено" />
  <Field of={form.f.title} />
  <Button type="submit" data-testid="create">Добавить</Button>
</Form>
