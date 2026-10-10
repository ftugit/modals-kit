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
  import type { DbPost } from '$lib/ui/demo/db-list/definition'
  import type { Optimistic } from '$lib/ui/demo/db-list/optimistic.svelte'

  interface Props {
    /** Ответ экшена `?/create` — continuation нативного пути (без JavaScript). */
    seed?: Result | null
    /**
     * Успешная запись: страница НЕ перезагружается, поэтому список обновляет
     * этот колбэк (он вызывает `reset` пагинатора — свежая страница из источника).
     */
    onApplied?: () => void
    /**
     * Оптимистичная карточка: форма пишет в неё ДО ответа, заменяет строкой из
     * ответа и откатывает по отказу. Без неё форма ведёт себя как раньше.
     */
    optimistic?: Optimistic | null
  }

  let { seed = null, onApplied, optimistic = null }: Props = $props()

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

  // Оптимистичная карточка — по ПЕРЕХОДАМ статуса формы, а не по обёртке
  // транспорта: `lib/form` сам решает, когда отправка состоялась (валидация,
  // debounce, серверные ошибки), и повторять его решения здесь значило бы иметь
  // второй автомат на те же данные. `submitCount` для этого не годится: поле
  // объявлено в `FormState` (state.ts:15), но ядром не увеличивается.
  //
  // Первый запуск эффекта не считается: `continuation` (путь без JS) тоже даёт
  // `success`, а список после перезагрузки и так свежий.
  let tmpId: string | null = null
  let last = form.state.status
  $effect(() => {
    const now = form.state.status
    if (now === last) return
    const was = last
    last = now
    if (!optimistic) {
      if (now === 'success' && was !== 'success') onApplied?.()
      return
    }
    if (now === 'submitting' && was !== 'submitting') {
      // Читаем значение поля в момент отправки: `values` формы — уже валидированный
      // снимок, и именно он уйдёт на сервер.
      // `tmpId` участвует в разборе: повтор после отказа обязан вернуть ТУ ЖЕ
      // карточку (иначе «повторить» плодит копию), а свежая отправка той же строки
      // — дать новую (уникальности по заголовку в схеме нет).
      tmpId = optimistic.begin(String(form.values.title ?? ''), tmpId)
      return
    }
    if (now === 'success' && was !== 'success') {
      const created = (form.state.result?.data as { created?: DbPost } | undefined)?.created
      if (tmpId) {
        // Строки в ответе нет — карточка не имеет права притворяться записью:
        // убираем её и отдаём слово источнику (он её пришлёт, если она есть).
        if (created) optimistic.confirm(tmpId, created)
        else optimistic.drop(tmpId)
      }
      tmpId = null
      onApplied?.()
      return
    }
    if (now === 'error' && was !== 'error') {
      // Ключ карточки сохраняется: следующая отправка (кнопка «повторить» на
      // карточке или обычный клик «Добавить») обязана вернуть её же, а не оставить
      // висящую «failed» копию рядом с новой. Сбрасывается только на успехе.
      if (tmpId) optimistic.fail(tmpId, reason())
    }
  })

  /** Текст отказа — тот же, что показывает форма, а не второй пересказ. */
  function reason(): string {
    const result = form.state.result
    if (result?.outcome === 'unknown') return 'неизвестно, применилось — проверьте список'
    const shown = form.state.shown
    return shown.length ? shown.map((e) => e.message).join('; ') : 'форма отклонена'
  }

  // «Повторить» на карточке отправляет ЭТУ форму, а не пересобирает запрос руками:
  // `requestSubmit` проходит через валидацию, envelope и транспорт — весь конвейер
  // `lib/form`, иначе повтор был бы отдельным недопроверенным путём.
  $effect(() => {
    optimistic?.setResubmit(() => {
      // `requestSubmit`, а не `form.submit()`: нативная отправка проходит валидацию
      // браузера, `onsubmit` перехватывает транспорт, и повтор = обычный путь.
      (document.getElementById('db-create-form') as HTMLFormElement | null)?.requestSubmit()
    })
  })
</script>

<Form id="db-create-form" form={form} hiddenFields={form.hidden()} class="space-y-3 rounded-xl border border-border bg-card p-4">
  <Common errors={form.common} title="Добавление отклонено" />
  <Field of={form.f.title} />
  <Button type="submit" data-testid="create">Добавить</Button>
</Form>
