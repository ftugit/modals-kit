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
  import { Button } from '$lib/ui/primitives'
  import { forms } from '$lib/ui/demo/form/forms.config'
  import Common from '$lib/ui/demo/form/ui/Common.svelte'
  import Field from '$lib/ui/demo/form/ui/Field.svelte'
  import { dbCreate } from './description'

  interface Props {
    /** Ответ экшена `?/create` — continuation, а не «перерисовать форму». */
    seed?: Result | null
  }

  let { seed = null }: Props = $props()

  // `continuation` читается один раз при создании связки; untrack — чтобы
  // Svelte не считал это «ссылка только на начальное значение».
  const form = bind(forms, dbCreate, {
    action: '?/create',
    intercept: false,
    live: 'on-submit',
    continuation: untrack(() => seed),
  })
</script>

<Form form={form} hiddenFields={form.hidden()} class="space-y-3 rounded-xl border border-border bg-card p-4">
  <Common errors={form.common} title="Добавление отклонено" />
  <Field of={form.f.title} />
  <Button type="submit" data-testid="create">Добавить</Button>
</Form>
