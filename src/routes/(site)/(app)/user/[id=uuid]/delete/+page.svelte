<script lang="ts">
  // Страница удаления — только носитель: ACL-гейт по данным `load`,
  // дальше компонент `ProfileDelete` (тот же, что в модалке пары).
  import { useHeadSeo } from '#components/shell/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import ProfileDelete from '#content/user/ui/profile-delete/ProfileDelete.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  useHeadSeo({
    subTitle: 'Удаление профиля',
    description: 'Подтверждение удаления профиля и аккаунта пользователя.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-sm">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref="/" />
  {:else if !data.canDeleteProfile}
    <Acl status="auth.forbidden" enabled={data.enabled} backHref="/" />
  {:else}
    <ProfileDelete
      uid={data.uid}
      canDeleteSeed={data.canDeleteSeed}
      holdSeconds={data.holdSeconds}
      action="?/profileDelete"
      doneHref="/"
      variant="card"
    />
  {/if}
</div>
