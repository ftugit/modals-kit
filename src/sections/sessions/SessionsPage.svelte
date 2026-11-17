<script lang="ts">
  // Журнал сессий — section-компонент (тонкий носитель в route).
  import type { loadSessionsJournal } from './load.server.js'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import SessionsList from '#modules/user/sessions/svelte/SessionsList.svelte'

  let { data }: { data: Awaited<ReturnType<typeof loadSessionsJournal>> } = $props()

  useHeadSeo({
    subTitle: 'Все сессии',
    description: 'Сессии всех аккаунтов, которые доступны на чтение.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-2xl">
  {#if data.fact || data.enabled === false}
    <Acl status={data.fact} enabled={data.enabled} backHref="/" />
  {:else}
    <SessionsList target={data.target} initial={data} variant="card" sidebar="middle" />
  {/if}
</div>
