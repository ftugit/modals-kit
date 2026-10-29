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

{#if acl === 'auth.forbidden'}
  <Acl model="forbidden" backHref="/" class="p-5" />
{:else if acl === 'auth.identity-unknown'}
  <Acl model="not_found" backHref="/" class="p-5" />
{:else if acl}
  <Acl status={acl} backHref="/" class="p-5" />
{:else}
  <BlocksList {uid} onAcl={(fact) => (acl = fact)} class="p-5" />
{/if}
