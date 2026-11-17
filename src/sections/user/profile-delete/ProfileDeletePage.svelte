<script lang="ts">
  // Страница удаления профиля — section-компонент (тонкий носитель в route).
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import ProfileDelete from '#modules/user/profile/svelte/profile-delete/ProfileDelete.svelte'
  import type { ProfileDeleteRouteData } from '#modules/user/profile/model/types.js'

  let { data }: { data: ProfileDeleteRouteData } = $props()

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
