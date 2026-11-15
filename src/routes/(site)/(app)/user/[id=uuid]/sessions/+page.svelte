<script lang="ts">
  // Устройства конкретного пользователя (`/user/[id]/sessions`) — тот же
  // `SessionsList`, что и свой список, но с целью в пропе `uid`.
  import { useHeadSeo } from '#components/shell/index.js'
  import { Button } from '#components/ui/index.js'
  import { useModalLink } from '#hooks/links/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import SessionsList from '#content/user/ui/SessionsList.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
  const asModalLink = useModalLink()
  const uid = $derived(data.target.kind === 'account' ? data.target.uid : null)

  useHeadSeo({
    subTitle: 'Сессии пользователя',
    description: 'Устройства, с которых выполнен вход в выбранный аккаунт.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-2xl">
  {#if data.fact || data.enabled === false}
    <Acl
      status={data.fact}
      enabled={data.enabled}
      backHref={uid ? `/user/${uid}` : '/'}
    />
  {:else}
    <div class="mb-3">
      <Button {...asModalLink('user.profile', { id: uid ?? '' })} variant="ghost" size="sm">
        ← К профилю
      </Button>
    </div>
    {#key uid}
      <SessionsList target={data.target} initial={data} variant="card" sidebar="middle" />
    {/key}
  {/if}
</div>
