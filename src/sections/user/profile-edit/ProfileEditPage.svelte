<script lang="ts">
  // Страница редактирования профиля — section-компонент (тонкий носитель в route).
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import ProfileForm from '#modules/user/profile/svelte/profile-form/ProfileForm.svelte'
  import type { ProfileEditRouteData } from './types.js'

  let { data }: { data: ProfileEditRouteData } = $props()

  useHeadSeo({
    subTitle: 'Редактирование профиля',
    description: 'Изменение имени и аватара профиля пользователя.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-sm">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref="/" />
  {:else if !data.canEdit}
    <Acl status="auth.forbidden" enabled={data.enabled} backHref="/" />
  {:else}
    <ProfileForm
      subject={data.uid}
      deleteId={data.canDeleteProfile ? data.uid : null}
      initial={data.profile ? { nickname: data.profile.nickname, avatarUrl: data.profile.avatarUrl } : null}
      limits={data.limits}
      enabled={data.enabled}
      doneHref={`/user/${data.uid}`}
      action={`/user/${data.uid}/edit?next=${encodeURIComponent(`/user/${data.uid}`)}`}
    />
  {/if}
</div>
