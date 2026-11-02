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
  type ProfileAcl = AuthErrorCode | 'not_found'
  let childAcl = $state<{ uid: string; snapshot: ProfileRouteData | null; value: ProfileAcl } | null>(null)
  const baseAcl = $derived.by((): ProfileAcl | null => {
    if (!uid) return 'not_found'
    const data = ldr.data
    if (!data) return null
    if (data.fact) return data.fact
    return !data.profile && !data.publicProfile && !data.notCreated ? 'not_found' : null
  })
  const acl = $derived(
    baseAcl ?? (childAcl?.uid === uid && childAcl.snapshot === (ldr.data ?? null) ? childAcl.value : null),
  )

  // Отказ относится к тому ответу и uid, при которых компонент начал работу.
  // Поздний ответ старой формы не должен блокировать новый слот или SWR.
  function onAclFor(currentUid: string, snapshot: ProfileRouteData | null | undefined) {
    return (value: ProfileAcl) => { childAcl = { uid: currentUid, snapshot: snapshot ?? null, value } }
  }
</script>

<Surface variant="plain" class="w-full p-6">
  {#if !uid || acl === 'not_found'}
    <Acl model="not_found" backHref="/" variant="plain" />
  {:else if acl}
    <Acl status={acl} enabled={ldr.data?.enabled} backHref="/" variant="plain" />
  {:else}
    <Profile {uid} route={ldr.data} variant="plain" onAcl={onAclFor(uid, ldr.data)} />
  {/if}
</Surface>
