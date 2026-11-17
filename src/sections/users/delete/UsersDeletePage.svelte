<script lang="ts">
  // Страница удаления аккаунтов (`/users/delete`) — fallback модалки
  // `user.accounts.delete`. Набор приходит адресом, срез считает сервер.
  import type { loadUsersDelete } from './load.server.js'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import AccountsDelete from '#modules/user/accounts/svelte/accounts-delete/AccountsDelete.svelte'
  import { userListRoute } from '#modules/user/base/routes.js'
  
  let { data }: { data: Awaited<ReturnType<typeof loadUsersDelete>> } = $props()

  const list = userListRoute.href()

  useHeadSeo({
    subTitle: 'Удаление аккаунтов',
    description: 'Подтверждение удаления выбранных аккаунтов или аккаунтов в срезе списка.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-sm">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref={list} />
  {:else}
    <AccountsDelete
      ids={data.ids}
      sliceFields={data.sliceFields}
      initial={data}
      doneHref={list}
    />
  {/if}
</div>
