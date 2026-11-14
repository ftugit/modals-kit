<script lang="ts">
  // Страница удаления аккаунтов (`/users/delete`) — fallback модалки
  // `user.accounts.delete`. Набор приходит адресом, срез считает сервер.
  import { useHeadSeo } from '#components/shell/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import AccountsDelete from '#content/user/ui/accounts-delete/AccountsDelete.svelte'
  import { userListRoute } from '#content/user/routes.js'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

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
