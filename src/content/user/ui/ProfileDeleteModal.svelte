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

{#if ldr.data?.fact}
  <Acl status={ldr.data.fact} backHref="/" class="p-5" />
{:else if ldr.data && !ldr.data.canDeleteProfile}
  <Acl status="auth.forbidden" backHref="/" class="p-5" />
{:else if ldr.data && uid}
  <div class="p-5">
    <ProfileDelete
      uid={uid}
      canDeleteSeed={ldr.data.canDeleteSeed}
      holdSeconds={ldr.data.holdSeconds}
      action="./?/profileDelete&next=/user/{uid}"
      doneHref="/user/{uid}"
    />
  </div>
{/if}
