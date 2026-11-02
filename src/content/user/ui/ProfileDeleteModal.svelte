<script lang="ts">
  /**
   * Удаление профиля в модалке (`?modal=user.profile.delete&id=…`) —
   * только носитель: ACL-гейт по данным загрузчика роута пары (флаг
   * `canDeleteProfile` чтения), дальше компонент `ProfileDelete` по id.
   * Права и запреты при отправке перепроверяет серверная форма.
   */
  import { invalidatePaginator } from '#lib/paginate/index.js'
  import { useLoader, useModal, useModals } from '#lib/modals/svelte/index.js'
  import Acl from './Acl.svelte'
  import ProfileDelete from './profile-delete/ProfileDelete.svelte'
  import { SEED_USERS_NAME } from './seed-users/source.js'
  import type { ProfileDeleteRouteData } from '../types.js'
  import { Surface } from '#components/ui/index.js'

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
    m.modals.invalidateLoader('user.list')
    void invalidatePaginator(SEED_USERS_NAME)
    m.modals.forceCloseAll()
  }
</script>

<Surface variant="plain" class="w-full p-6">
  {#if ldr.data?.fact}
    <Acl status={ldr.data.fact} backHref="/" variant="plain" />
  {:else if ldr.data && !ldr.data.canDeleteProfile}
    <Acl status="auth.forbidden" backHref="/" variant="plain" />
  {:else if ldr.data && uid}
    <ProfileDelete
      uid={uid}
      canDeleteSeed={ldr.data.canDeleteSeed}
      holdSeconds={ldr.data.holdSeconds}
      action="./?/profileDelete"
      variant="plain"
      onDone={done}
    />
  {/if}
</Surface>
