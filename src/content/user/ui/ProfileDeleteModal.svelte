<script lang="ts">
  /**
   * Удаление профиля в модалке (`?modal=user.profile.delete&id=…`) —
   * только носитель: ACL-гейт по данным загрузчика роута пары (флаг
   * `canDeleteProfile` чтения), дальше компонент `ProfileDelete` по id.
   * Права и запреты при отправке перепроверяет серверная форма.
   */
  import { useLoader, useModal, useModals } from '#lib/modals/svelte/index.js'
  import Acl from './Acl.svelte'
  import ProfileDelete from './profile-delete/ProfileDelete.svelte'
  import type { ProfileDeleteRouteData } from '../types.js'

  const modal = useModal<{ id: string }>()
  const m = useModals()
  const ldr = useLoader<ProfileDeleteRouteData>()
  const uid = $derived(modal.params?.id ?? ldr.data?.uid ?? '')

  /**
   * Профиля больше нет: показ под модалкой (и списки) устарел, их кеш
   * сбрасывается сразу — при возврате на шаг назад они перезапросятся.
   */
  function done() {
    m.modals.invalidateLoader('user.profile')
    m.modals.invalidateLoader('user.profile.delete')
    m.modals.invalidateLoader('user.list')
  }
</script>

<div class="my-auto w-full p-6">
  {#if ldr.data?.fact}
    <Acl status={ldr.data.fact} backHref="/" variant="plain" />
  {:else if ldr.data && !ldr.data.canDeleteProfile}
    <Acl status="auth.forbidden" backHref="/" variant="plain" />
  {:else if ldr.data && uid}
    <ProfileDelete
      uid={uid}
      canDeleteSeed={ldr.data.canDeleteSeed}
      holdSeconds={ldr.data.holdSeconds}
      action="./?/profileDelete&next=/user/{uid}"
      doneHref="/user/{uid}"
      variant="plain"
      onDone={done}
    />
  {/if}
</div>
