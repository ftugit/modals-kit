<script lang="ts">
  /**
   * Профиль в модалке (`?modal=user.profile&id=…`) — только носитель:
   * максимум ACL-гейт. Данные модалка не запрашивает: их приносит загрузчик
   * записи (тот же `load` роута `/user/[id]`), отсюда они уходят в компонент
   * `Profile` пропсом `route` — рисует и проецирует он один, как и на
   * странице. Отказ компонент сообщает наверх, его рисует носитель экраном
   * `Acl`, как страница.
   */
  import { useLoader, useModal } from '#lib/modals/svelte/index.js'
  import Acl from './Acl.svelte'
  import Profile from './Profile.svelte'
  import type { AuthErrorCode } from '../error.js'
  import type { ProfileRouteData } from '../types.js'
  import { Surface } from '#components/ui/index.js'

  const modal = useModal<{ id: string }>()
  const ldr = useLoader<ProfileRouteData>()
  const uid = $derived(modal.params?.id ?? ldr.data?.uid ?? '')
  let acl = $state<AuthErrorCode | 'not_found' | null>(null)
</script>

<Surface variant="plain" class="w-full p-6">
  {#if !uid || acl === 'not_found'}
    <Acl model="not_found" backHref="/" variant="plain" />
  {:else if acl}
    <Acl status={acl} backHref="/" variant="plain" />
  {:else}
    <Profile {uid} route={ldr.data} variant="plain" onAcl={(what) => (acl = what)} />
  {/if}
</Surface>
