<script lang="ts">
  // Страница редактирования профиля — только носитель: ACL-гейт по
  // данным `load`, дальше форма по id (как модалка той же пары).
  import { useHeadSeo } from '#components/shell/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import ProfileForm from '#content/user/ui/profile-form/ProfileForm.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  useHeadSeo({
    subTitle: 'Редактирование профиля',
    description: 'Изменение имени и аватара профиля пользователя.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-sm">
  {#if data.fact}
    <Acl status={data.fact} backHref="/" />
  {:else if !data.canEdit}
    <Acl status="auth.forbidden" backHref="/" />
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
