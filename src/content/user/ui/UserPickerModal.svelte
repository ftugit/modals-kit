<script lang="ts">
  /**
   * Носитель пикера пользователей в модалке (`user.picker`).
   * Результат пишется на общую доску модалок (`sharedData['picker:' + channel]`),
   * после чего закрывается только верхний слой пикера — вызывающая модалка или
   * страница остаётся открытой с прежним состоянием.
   */
  import { useLoader, useModal, useModals } from '#lib/modals/svelte/index.js'
  import Acl from './Acl.svelte'
  import UserPicker, { USER_PICKER_CHANNEL_PREFIX } from './UserPicker.svelte'
  import type { SeedUsersRouteData } from './seed-users/source.js'
  import type { AuthErrorCode } from '../error.js'

  const m = useModals()
  const ldr = useLoader<{ initialUsers?: SeedUsersRouteData }>()
  const modal = useModal<{
    mode?: 'single' | 'multiple'
    channel?: string
    picked?: string
  }>()

  const mode = $derived(modal.params?.mode === 'single' ? 'single' : 'multiple')
  const channel = $derived(String(modal.params?.channel ?? 'default'))
  const initialPicked = $derived(
    String(modal.params?.picked ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )

  let acl = $state<AuthErrorCode | null>(null)

  function confirm(ids: string[]) {
    m.modals.store.merge('sharedData', {
      [`${USER_PICKER_CHANNEL_PREFIX}${channel}`]: {
        seq: Date.now(),
        ids,
      },
    })
    m.modals.close()
  }
</script>

{#if acl === 'auth.forbidden'}
  <Acl model="forbidden" backHref="/" class="p-5" />
{:else if acl}
  <Acl status={acl} backHref="/" class="p-5" />
{:else}
  <UserPicker
    {mode}
    {initialPicked}
    initialUsers={ldr.data?.initialUsers}
    onConfirm={confirm}
    onCancel={() => m.modals.close()}
    onAcl={(fact) => (acl = fact)}
    class="p-5"
  />
{/if}
