<script lang="ts">
  /**
   * Форма добавления записи — отдельный компонент, как и остальные формы демо
   * (`src/lib/components/form/*`): связка `bind` + `Form` + `Common`/`Field`
   * живёт здесь, страница передаёт только результат экшена.
   *
   * Отправка идёт нативным `form`-путём (action `?/create`), потому что слой
   * `lib/form` держит origin, лимит тела, имена и валидацию; собственный
   * `fetch` в обход него здесь запрещён сборкой (`npm run test:guard`).
   */
  import { untrack } from 'svelte'
  import { bind, Form, formTask } from '#lib/form/svelte/index.js'
  import type { Result } from '#lib/form/index.js'
  import { jsonTransport } from '#lib/components/form/transport.js'
  import { Button } from '#lib/components/ui/index.js'
  import { forms } from '#lib/components/form/forms.config.js'
  import Common from '#lib/components/form/Common.svelte'
  import Field from '#lib/components/form/Field.svelte'
  import { dbCreate } from './description'
  import type { DbPost } from './definition'
  import type { Optimistic } from './optimistic.svelte'

  interface Props {
    /** Ответ экшена `?/create` — continuation нативного пути (без JavaScript). */
    seed?: Result | null
    /**
     * Успешная запись: страница НЕ перезагружается, поэтому список обновляет
     * этот колбэк — строкой из ответа (`null`, если сервер её не вернул).
     * `true` — строка встала в окно списка, и оптимистичная карточка больше не
     * нужна: форма её убирает.
     */
    onApplied?: (created: DbPost | null) => boolean | void
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
  // второй автомат на те же данные. `submitCount` для этого не годится: привязка
  // увеличивает его в НАЧАЛЕ отправки (`bind.svelte.ts`, `submit`), а не по итогу.
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
      if (now === 'success' && was !== 'success') onApplied?.(createdRow())
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
      const created = createdRow()
      const id = tmpId
      if (id) {
        // Строки в ответе нет — карточка не имеет права притворяться записью:
        // убираем её и отдаём слово источнику (он её пришлёт, если она есть).
        if (created) optimistic.confirm(id, created)
        else optimistic.drop(id)
      }
      tmpId = null
      // Строка встала в окно — карточка своё отслужила. Иначе (место знает только
      // сервер) подтверждённая карточка остаётся до следующей загрузки списка.
      if (onApplied?.(created) === true && id && created) optimistic.drop(id)
      return
    }
    if (now === 'error' && was !== 'error') {
      // Ключ карточки сохраняется: следующая отправка (кнопка «повторить» на
      // карточке или обычный клик «Добавить») обязана вернуть её же, а не оставить
      // висящую «failed» копию рядом с новой. Сбрасывается только на успехе.
      if (tmpId) optimistic.fail(tmpId, reason())
    }
  })

  const createdRow = (): DbPost | null =>
    (form.state.result?.data as { created?: DbPost } | undefined)?.created ?? null

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
  <!-- поле только формы: в базу не идёт (сервер отдаёт базе pick(['title'])) -->
  <Field of={form.f.agree} />
  <Button type="submit" data-testid="create" task={formTask(form.state)}>Добавить</Button>
</Form>
