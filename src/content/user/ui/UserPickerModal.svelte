<script lang="ts">
  /**
   * Носитель пикера пользователей в модалке (`user.picker`).
   * Результат пишется на общую доску модалок (`sharedData['picker:' + channel]`),
   * после чего закрывается только верхний слой пикера — вызывающая модалка или
   * страница остаётся открытой с прежним состоянием.
   */
  import { tick } from 'svelte'
  import { useLoader, useModal, useModals } from '#lib/modals/svelte/index.js'
  import Acl from './Acl.svelte'
  import UserPicker, { USER_PICKER_CHANNEL_PREFIX } from './UserPicker.svelte'
  import type { SeedUsersRouteData } from './seed-users/source.js'
  import type { AuthErrorCode } from '../error.js'
  import { Surface } from '#components/ui/index.js'

  const m = useModals()
  const ldr = useLoader<{
    initialUsers?: SeedUsersRouteData
    fact?: AuthErrorCode | null
    enabled?: boolean
  }>()
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
  const effectiveAcl = $derived(acl ?? ldr.data?.fact ?? ldr.data?.initialUsers?.fact ?? null)
  const isEnabled = $derived(ldr.data?.enabled ?? ldr.data?.initialUsers?.enabled)

  async function confirm(ids: string[]) {
    m.modals.store.merge('sharedData', {
      [`${USER_PICKER_CHANNEL_PREFIX}${channel}`]: {
        seq: Date.now(),
        ids,
      },
    })
    // Прокачиваем реактивных подписчиков `sharedData` ДО `close()`, чтобы
    // страничные носители (`/blocks/new`) успели поставить `writeAddress` в
    // очередь писателя адреса перед `go(-1)` (для переноса `carry`), а
    // модальные носители — обновить `setParams` (переносится `pendingBackTarget`).
    await tick()
    m.modals.close()
  }
</script>

<Surface variant="plain" scroll={false} class="flex min-h-0 flex-1 flex-col w-full p-6">
  {#if isEnabled === false || effectiveAcl}
    <Acl status={effectiveAcl} enabled={isEnabled} backHref="/" variant="plain" />
  {:else}
    <UserPicker
      {mode}
      {initialPicked}
      initialUsers={ldr.data?.initialUsers}
      variant="plain"
      class="min-h-0 flex-1"
      onConfirm={confirm}
      onCancel={() => m.modals.close()}
      onAcl={(fact) => (acl = fact)}
    />
  {/if}
</Surface>
