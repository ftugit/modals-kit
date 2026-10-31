<script lang="ts">
  /**
   * Модалка списка блокировок (`user.blocks`): носитель и ACL-гейт.
   * При переданном `params.id` показывает блокировки этого пользователя,
   * без `id` — глобальный список блокировок. Данные приносит загрузчик
   * записи (тот же `load` роута) и отдаёт списку пропсом `initial`.
   */
  import { useLoader, useModal, useRuntimeKey } from '#lib/modals/svelte/index.js'
  import Acl from './Acl.svelte'
  import BlocksList from './BlocksList.svelte'
  import type { AuthErrorCode } from '../error.js'
  import type { BlocksRouteData } from './blocks-list/source.js'

  const modal = useModal<{ id?: string }>()
  const ldr = useLoader<BlocksRouteData>()
  const uid = $derived(modal.params?.id ? String(modal.params.id) : null)
  // Область пагинатора этой записи: ключ стабилен, пока запись в стопке.
  const scope = useRuntimeKey()
  let acl = $state<AuthErrorCode | null>(null)
</script>

<div class="flex min-h-0 flex-auto flex-col p-6">
  {#if acl === 'auth.forbidden'}
    <Acl model="forbidden" backHref="/" variant="plain" />
  {:else if acl === 'auth.identity-unknown'}
    <Acl model="not_found" backHref="/" variant="plain" />
  {:else if acl}
    <Acl status={acl} backHref="/" variant="plain" />
  {:else}
    <BlocksList
      {uid}
      {scope}
      initial={ldr.data}
      variant="plain"
      onAcl={(fact) => (acl = fact)}
    />
  {/if}
</div>
