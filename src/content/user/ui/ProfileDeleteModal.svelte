<script lang="ts">
  /**
   * Удаление профиля в модалке (`?modal=user.profile.delete&id=…`) —
   * только носитель: ACL-гейт по данным загрузчика роута пары (флаг
   * `canDeleteProfile` чтения), дальше компонент `ProfileDelete` по id.
   * Права и запреты при отправке перепроверяет серверная форма.
   */
  import { useLoader, useModal } from '#lib/modals/svelte/index.js'
  import Acl from './Acl.svelte'
  import ProfileDelete from './profile-delete/ProfileDelete.svelte'
  import type { ProfileDeleteRouteData } from '../types.js'

  const modal = useModal<{ id: string }>()
  const ldr = useLoader<ProfileDeleteRouteData>()
  const uid = $derived(modal.params?.id ?? ldr.data?.uid ?? '')
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
    />
  {/if}
</div>
