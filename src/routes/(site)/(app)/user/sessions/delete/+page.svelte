<script lang="ts">
  // Страница закрытия устройств своего аккаунта (`/user/sessions/delete`) —
  // fallback модалки `user.session.delete`; без JS форма уходит обычным POST на
  // этот адрес, а переход объявлен в регистрации компонентной формы.
  import { useHeadSeo } from '#components/shell/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import SessionDelete from '#content/user/ui/session-delete/SessionDelete.svelte'
  import { userSessionsRoute } from '#content/user/routes.js'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  const list = userSessionsRoute.href()

  useHeadSeo({
    subTitle: 'Закрытие устройств',
    description: 'Подтверждение закрытия выбранных авторизаций.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-sm">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref={list} />
  {:else}
    <SessionDelete ids={data.ids} variant={data.variant} initial={data} doneHref={list} />
  {/if}
</div>
