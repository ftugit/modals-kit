<script lang="ts">
  // Страница удаления — только носитель: ACL-гейт по данным `load`,
  // дальше компонент `ProfileDelete` (тот же, что в модалке пары).
  import Acl from '#content/user/ui/Acl.svelte'
  import ProfileDelete from '#content/user/ui/profile-delete/ProfileDelete.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<svelte:head><title>Удаление профиля</title></svelte:head>

<div class="mx-auto w-full max-w-sm">
  {#if data.fact}
    <Acl status={data.fact} backHref="/" />
  {:else if !data.canDeleteProfile}
    <Acl status="auth.forbidden" backHref="/" />
  {:else}
    <ProfileDelete
      uid={data.uid}
      canDeleteSeed={data.canDeleteSeed}
      holdSeconds={data.holdSeconds}
      action="?/profileDelete&next=/user/{data.uid}"
      doneHref="/user/{data.uid}"
    />
  {/if}
</div>
