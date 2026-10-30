<script lang="ts">
  /**
   * Редактирование профиля в модалке (`?modal=user.profile.edit&id=…`) —
   * только носитель: ACL-гейт по данным загрузчика роута пары, дальше
   * форма `ProfileForm` по id. Права на запись перепроверяют серверная
   * форма и модель; успешное сохранение закрывает модалку, показ под
   * ней профиль перечитает сам.
   */
  import { useLoader, useModal, useModals } from '#lib/modals/svelte/index.js'
  import Acl from './Acl.svelte'
  import ProfileForm from './profile-form/ProfileForm.svelte'
  import type { ProfileView } from '../types.js'
  import type { AuthErrorCode } from '../error.js'

  type EditRouteData = {
    uid: string
    profile: ProfileView | null
    canEdit: boolean
    canDeleteProfile: boolean
    fact: AuthErrorCode | null
    enabled: boolean
    limits: { readonly nicknameForbidden: readonly string[] }
  }

  const modal = useModal<{ id: string }>()
  const m = useModals()
  const ldr = useLoader<EditRouteData>()
  const uid = $derived(modal.params?.id ?? ldr.data?.uid ?? '')
</script>

<div class="my-auto w-full p-6">
  {#if ldr.data?.fact}
    <Acl status={ldr.data.fact} backHref="/" variant="plain" />
  {:else if ldr.data && !ldr.data.canEdit}
    <Acl status="auth.forbidden" backHref="/" variant="plain" />
  {:else if ldr.data && uid}
    <ProfileForm
      subject={uid}
      deleteId={ldr.data.canDeleteProfile ? uid : null}
      initial={ldr.data.profile ? { nickname: ldr.data.profile.nickname, avatarUrl: ldr.data.profile.avatarUrl } : null}
      limits={ldr.data.limits}
      enabled={ldr.data.enabled}
      doneHref="/"
      variant="plain"
      onDone={() => m.modals.close()}
    />
  {/if}
</div>
