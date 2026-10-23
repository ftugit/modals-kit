<script lang="ts">
  /**
   * Экран полного бана аккаунта (`scope: 'auth'`).
   *
   * При полном бане сессия не выдаётся (`auth.ts`), поэтому субъект всегда
   * остаётся гостем (`allow="guest"`). Авторизованному пользователю экран бана
   * не открывается — срабатывает `guest_only` внутри `Acl`.
   */
  import Acl, { type UserSurfaceVariant } from './Acl.svelte'

  interface Props {
    blocked?: { readonly reason: string; readonly untilMs: number | null } | null
    authorized?: boolean
    backHref?: string
    variant?: UserSurfaceVariant
    class?: string
  }

  let {
    blocked = null,
    authorized,
    backHref = '/' ,
    variant,
    class: className,
  }: Props = $props()
</script>

<Acl
  allow="guest"
  {authorized}
  blocked={blocked ?? { reason: 'не указана', untilMs: null }}
  {backHref}
  {variant}
  class={className}
/>
