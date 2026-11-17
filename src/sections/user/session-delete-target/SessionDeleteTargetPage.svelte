<script lang="ts">
  // Страница закрытия устройств переданного аккаунта
  // (`/user/[id]/sessions/delete`) — второй адрес той же единицы.
  import type { loadSessionDeleteTarget } from './load.server.js'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import SessionDelete from '#modules/user/base/svelte/session-delete/SessionDelete.svelte'
  import { userAccountSessionsRoute } from '#modules/user/base/routes.js'
  
  let { data }: { data: Awaited<ReturnType<typeof loadSessionDeleteTarget>> } = $props()

  const list = $derived(userAccountSessionsRoute.href({ id: String(data.contextUid) }))

  useHeadSeo({
    subTitle: 'Закрытие устройств аккаунта',
    description: 'Подтверждение закрытия авторизаций целевого аккаунта.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-sm">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref={list} />
  {:else}
    <SessionDelete
      ids={data.ids}
      variant={data.variant}
      sliceFields={data.sliceFields}
      initial={data}
      doneHref={list}
    />
  {/if}
</div>
