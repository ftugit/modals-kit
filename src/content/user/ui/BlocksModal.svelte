<script lang="ts">
  /**
   * Модалка списка блокировок (`user.blocks`): носитель и ACL-гейт.
   * При переданном `params.id` показывает блокировки этого пользователя,
   * без `id` — глобальный список блокировок.
   */
  import { useModal } from '#lib/modals/svelte/index.js'
  import Acl from './Acl.svelte'
  import BlocksList from './BlocksList.svelte'
  import type { AuthErrorCode } from '../error.js'

  const modal = useModal<{ id?: string }>()
  const uid = $derived(modal.params?.id ? String(modal.params.id) : null)
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
    <BlocksList {uid} variant="plain" onAcl={(fact) => (acl = fact)} />
  {/if}
</div>
