<script lang="ts">
  // Устройства конкретного пользователя — section-компонент (тонкий носитель в route).
  import type { loadUserSessions } from './load.server.js'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import { Button } from '#core/ui/index.js'
  import { useModalLink } from '#core/hooks/links/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import SessionsList from '#modules/user/sessions/svelte/SessionsList.svelte'

  let { data }: { data: Awaited<ReturnType<typeof loadUserSessions>> } = $props()
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
