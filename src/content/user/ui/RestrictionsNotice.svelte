<script lang="ts">
  /**
   * Экран частичных ограничений действий аккаунта (`scope !== 'auth'`).
   *
   * Сессия при частичных ограничениях уже выдана (`auth.ts`), поэтому экран
   * доступен только авторизованному пользователю (`allow="user"`). Кнопка
   * «Принято» отправляется штатной формой через `bindComponentForm` (одинаково
   * работает и с JS, и без JS).
   */
  import { untrack } from 'svelte'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { forms } from '#components/form/forms.config.js'
  import { Button } from '#components/ui/index.js'
  import { seedForm } from './seed-form/form.js'
  import type { Blocked } from '../types.js'
  import Acl, { type UserSurfaceVariant } from './Acl.svelte'

  interface RestrictionItem {
    readonly scope: string
    readonly reason: string
    readonly untilMs: number | null
  }

  interface Props {
    restrictions?: readonly RestrictionItem[] | null
    authorized?: boolean
    doneHref?: string
    onDone?: () => void
    variant?: UserSurfaceVariant
    class?: string
  }

  let {
    restrictions = null,
    authorized,
    doneHref = '/',
    onDone,
    variant,
    class: className,
  }: Props = $props()

  const bound = bindComponentForm(forms, seedForm)

  const normalized = $derived<readonly Blocked[]>(
    (restrictions ?? []).map((r) => ({
      scope: `${r.scope}`,
      reason: `${r.scope}: ${r.reason}`,
      at: 0,
      ...(r.untilMs ? { until: r.untilMs } : {}),
    })),
  )

  let lastHandled = ''
  $effect(() => {
    const r = bound.state.result
    if (!r?.ok || r.submissionId === lastHandled) return
    const data = r.data as { step?: string } | undefined
    if (data?.step === 'done') {
      lastHandled = r.submissionId
      untrack(() => onDone?.())
    }
  })
</script>

<Acl
  allow="user"
  {authorized}
  status="restrictions"
  restrictions={normalized}
  backHref={doneHref}
  {variant}
  class={className}
>
  {#snippet actions()}
    <Form form={bound} hiddenFields={bound.hidden()} class="flex justify-end">
      <Button
        type="submit"
        name="intent"
        value="accept"
        variant="outline"
        task={formTask(bound.state, 'accept')}
      >
        Принято
      </Button>
    </Form>
  {/snippet}
</Acl>
