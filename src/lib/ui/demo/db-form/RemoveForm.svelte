<script lang="ts">
  /**
   * Форма удаления — отдельный компонент по тому же правилу, что и
   * `CreateForm`: страница не собирает связку форм. id строк показывает
   * список, поэтому поле видимое и текстовое (значение можно скопировать).
   */
  import { untrack } from 'svelte'
  import { bind, Form } from '$lib/form/svelte'
  import type { Result } from '$lib/form'
  import { Button } from '$lib/ui/primitives'
  import { forms } from '$lib/ui/demo/form/forms.config'
  import Common from '$lib/ui/demo/form/ui/Common.svelte'
  import Field from '$lib/ui/demo/form/ui/Field.svelte'
  import { dbRemove } from './description'

  interface Props {
    /** Ответ экшена `?/remove`. */
    seed?: Result | null
  }

  let { seed = null }: Props = $props()

  const form = bind(forms, dbRemove, {
    action: '?/remove',
    intercept: false,
    live: 'on-submit',
    continuation: untrack(() => seed),
  })
</script>

<Form form={form} hiddenFields={form.hidden()} class="space-y-3 rounded-xl border border-border bg-card p-4">
  <Common errors={form.common} title="Удаление отклонено" />
  <Field of={form.f.ids} />
  <Button variant="outline" type="submit" data-testid="remove">Удалить</Button>
</Form>
