<script lang="ts">
  // Свои устройства — section-компонент (тонкий носитель в route).
  import type { loadUserSessions } from './load.server.js'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import { Button } from '#core/ui/index.js'
  import { useModalLink } from '#core/hooks/links/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import SessionsList from '#modules/user/sessions/svelte/SessionsList.svelte'

  let { data }: { data: Awaited<ReturnType<typeof loadUserSessions>> } = $props()
  const asModalLink = useModalLink()

  useHeadSeo({
    subTitle: 'Сессии',
    description: 'Устройства, с которых выполнен вход в аккаунт.',
    noindex: true,
  })
</script>

<!-- keep original page simpler: just render list -->
<div class="mx-auto w-full max-w-2xl">
  {#if data.fact || data.enabled === false}
    <Acl status={data.fact} enabled={data.enabled} backHref="/" />
  {:else}
    <SessionsList target={data.target} initial={data} variant="card" sidebar="middle" />
  {/if}
</div>
