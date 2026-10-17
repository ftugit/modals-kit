<script lang="ts">
  /**
   * Сброс демо — то, что справа от шагов на «Результате».
   *
   * Внешне — ссылка, как просили; по сути — отправка формы: сброс чистит
   * набор и запись на сервере, а GET-ссылкой состояние не чистят (предзагрузка
   * страницы снесла бы данные без спроса). Поэтому ссылка-кнопка отправляет
   * форму на `?/reset`, и так же она работает без скрипта.
   */
  import { untrack } from 'svelte'
  import { replaceState } from '$app/navigation'
  import { page } from '$app/state'
  import { bind, Form } from '#lib/form/svelte/index.js'
  import { Button } from '#lib/components/ui/index.js'
  import { forms } from '#lib/components/form/forms.config.js'
  import { resetForm } from './forms'

  // без перехвата: сброс — один нативный POST с редиректом на «Сборку»
  const form = bind(forms, untrack(() => resetForm()), { action: '?/reset', intercept: false })
</script>

<!-- Нативный POST обрывается, если во время него щёлкнуть ссылку: шаги
     блокируются. Замок пишется в состояние записи истории ДО отправки —
     тогда его видит и ещё не ожившая страница. -->
<Form
  form={form}
  hiddenFields={form.hidden()}
  class="inline-flex"
  onsubmit={() => void replaceState(page.url.href, { ...page.state, fieldsNavLocked: true })}
>
  <Button type="submit" variant="link" size="none" data-testid="reset" {...form.intent('reset')}>
    Сбросить
  </Button>
</Form>
