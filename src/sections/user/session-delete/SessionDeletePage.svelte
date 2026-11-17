<script lang="ts">
  // Страница закрытия устройств своего аккаунта — section-компонент (тонкий носитель в route).
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import SessionDelete from '#modules/user/base/svelte/session-delete/SessionDelete.svelte'
  import { userSessionsRoute } from '#modules/user/base/routes.js'
  import type { SessionDeleteRouteData } from '#modules/user/base/model/types.js'

  let { data }: { data: SessionDeleteRouteData } = $props()

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
    <SessionDelete ids={data.ids} variant={data.variant} sliceFields={data.sliceFields} initial={data} doneHref={list} />
  {/if}
</div>
