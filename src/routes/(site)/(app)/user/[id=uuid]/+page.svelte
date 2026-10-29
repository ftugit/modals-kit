<script lang="ts">
  // Страница профиля — только носитель: ACL-гейт по данным `load`, дальше
  // показывает компонент профиля с данными того же `load` (второй запрос
  // не нужен). «Профиля нет» и карточку рисует сам компонент — как в
  // модалке, поэтому формы показа разойтись не могут.
  import Acl from '#content/user/ui/Acl.svelte'
  import Profile from '#content/user/ui/Profile.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<svelte:head><title>Профиль</title></svelte:head>

<div class="mx-auto w-full max-w-sm">
  {#if data.fact}
    <Acl status={data.fact} backHref="/" />
  {:else if data.publicProfile}
    <Profile uid={data.uid} initialPublic={data.publicProfile} />
  {:else if !data.profile && !data.notCreated}
    <Acl model="not_found" backHref="/" />
  {:else}
    <Profile
      uid={data.uid}
      initial={{
        profile: data.profile,
        isOwn: data.isOwn,
        visibility: data.visibility,
        notCreated: data.notCreated,
        canEdit: data.canEdit,
        canDeleteProfile: data.canDeleteProfile,
        canDeleteSeed: data.canDeleteSeed,
        fullBlock: data.fullBlock,
        blocks: data.blocks,
        canReadBlocks: data.canReadBlocks,
        canBlock: data.canBlock,
      }}
    />
  {/if}
</div>
