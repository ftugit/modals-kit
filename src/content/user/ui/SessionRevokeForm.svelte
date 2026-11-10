<script lang="ts">
  /**
   * Блокировка одной своей сессии. Адрес абсолютный: форма живёт и на
   * `/user/sessions`, и в модалке поверх другой страницы. `intercept: false` —
   * удержание вызывает обычный POST, без JS кнопка отправляется сама.
   */
  import { untrack } from 'svelte'
  import Field from '#components/form/Field.svelte'
  import { forms } from '#components/form/forms.config.js'
  import HoldButton from '#components/ui/button/HoldButton.svelte'
  import { bind, Form } from '#lib/form/svelte/index.js'
  import { sessionRevokeForm } from '../sessions.form.js'

  let {
    id,
    label = 'Заблокировать',
    testId = 'session-revoke',
    variant = 'outline',
  }: {
    id: string
    label?: string
    testId?: string
    variant?: 'outline' | 'ghost' | 'destructive'
  } = $props()

  const sessionId = untrack(() => id)
  const form = bind(forms, sessionRevokeForm(sessionId), {
    action: '/user/sessions?/revoke',
    intercept: false,
  })
</script>

<Form {form} hiddenFields={form.hidden()} class="inline-flex">
  <div hidden>
    <Field of={form.f.id} />
  </div>
  <HoldButton type="submit" {variant} size="sm" seconds={2} data-testid={testId}>
    {label}
  </HoldButton>
</Form>
