<script lang="ts">
  // Страница списка seed-юзеров — section-компонент (тонкий носитель в route).
  import type { loadUsers } from './load.server.js'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import SeedUsersList from '#modules/user/accounts/svelte/SeedUsersList.svelte'

  let { data }: { data: Awaited<ReturnType<typeof loadUsers>> } = $props()

  useHeadSeo({
    subTitle: 'Seed-юзеры',
    description: 'Список аккаунтов пользователей с фильтрацией и проверкой прав доступа.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-2xl">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref="/" />
  {:else}
    <SeedUsersList initial={data} variant="card" sidebar="middle" />
  {/if}
</div>
