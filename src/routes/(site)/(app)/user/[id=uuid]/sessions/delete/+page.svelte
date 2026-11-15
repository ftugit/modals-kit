<script lang="ts">
  // Страница закрытия устройств переданного аккаунта
  // (`/user/[id]/sessions/delete`) — второй адрес той же единицы.
  import { useHeadSeo } from '#components/shell/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import SessionDelete from '#content/user/ui/session-delete/SessionDelete.svelte'
  import { userAccountSessionsRoute } from '#content/user/routes.js'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

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
