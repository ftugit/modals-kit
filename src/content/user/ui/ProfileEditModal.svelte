<script lang="ts">
  /**
   * Редактирование профиля в модалке (`?modal=user.profile.edit&id=…`) —
   * только носитель: ACL-гейт по данным загрузчика роута пары, дальше
   * форма `ProfileForm` по id. Права на запись перепроверяют серверная
   * форма и модель; успешное сохранение закрывает модалку, показ под
   * ней профиль перечитает сам.
   */
  import { invalidatePaginator } from '#lib/paginate/index.js'
  import { useLoader, useModal, useModals } from '#lib/modals/svelte/index.js'
  import Acl from './Acl.svelte'
  import ProfileForm from './profile-form/ProfileForm.svelte'
  import { SEED_USERS_NAME } from './seed-users/source.js'
  import type { ProfileView } from '../types.js'
  import type { AuthErrorCode } from '../error.js'
  import { Surface } from '#components/ui/index.js'

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

  /**
   * Успешное сохранение: поля показывают профиль, его форма и списки,
   * поэтому их кеш сбрасывается ДО закрытия — когда нижняя запись снова
   * станет активной, хост перезапустит её загрузчик на свежих данных.
   */
  function done() {
    m.modals.invalidateLoader('user.profile')
    m.modals.invalidateLoader('user.profile.edit')
    m.modals.invalidateLoader('user.list')
    void invalidatePaginator(SEED_USERS_NAME)
    m.modals.close()
  }
</script>

<Surface variant="plain" scroll={false} class="flex min-h-0 flex-1 flex-col w-full p-6">
  {#if ldr.data?.fact}
    <Acl status={ldr.data.fact} enabled={ldr.data.enabled} backHref="/" variant="plain" />
  {:else if ldr.data && !ldr.data.canEdit}
    <Acl status="auth.forbidden" enabled={ldr.data.enabled} backHref="/" variant="plain" />
  {:else if ldr.data && uid}
    <ProfileForm
      class="min-h-0 flex-1"
      subject={uid}
      deleteId={ldr.data.canDeleteProfile ? uid : null}
      initial={ldr.data.profile ? { nickname: ldr.data.profile.nickname, avatarUrl: ldr.data.profile.avatarUrl } : null}
      limits={ldr.data.limits}
      enabled={ldr.data.enabled}
      doneHref="/"
      variant="plain"
      onDone={done}
    />
  {/if}
</Surface>
