<script lang="ts">
  /**
   * Выход — тонкая оболочка вокруг единицы закрытия устройств с вариантом
   * «выход» (`user.session.delete` с `variant=logout`). Собственной раз markup
   * нет: сценарии ответа и куки разбирает компонент удаления.
   */
  import SessionDelete from '../session-delete/SessionDelete.svelte'

  interface Props {
    sessionId?: string | null
    total?: number
    canRevoke?: boolean
    action?: string
    localAction?: string
    backHref?: string
    mode?: 'page' | 'modal'
    holdSeconds?: number
    variant?: string
    class?: string
  }

  let {
    sessionId = null,
    total = 0,
    canRevoke = true,
    action,
    localAction,
    backHref,
    mode = 'page',
    holdSeconds = 2,
    variant: surfaceVariant = 'plain',
    class: className,
  }: Props = $props()

  const ids = $derived(sessionId ? [sessionId] : [])
</script>

<div class={className}>
  <SessionDelete
    {ids}
    variant="logout"
    initial={{
      contextUid: null,
      ids,
      tooMany: false,
      variant: 'logout',
      enabled: canRevoke,
      holdSeconds,
      fact: null,
    }}
    action={action ?? '/user/logout?/exit'}
    localAction={localAction ?? '/user/logout?/local'}
    doneHref={backHref ?? '/'}
  />
</div>
