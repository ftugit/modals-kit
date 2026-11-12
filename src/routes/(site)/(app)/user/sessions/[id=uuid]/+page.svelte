<script lang="ts">
  // Страница карточки устройства — fallback модалки `user.session`.
  import { useHeadSeo } from '#components/shell/index.js'
  import { userSessionsRoute } from '#content/user/routes.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import SessionCard from '#content/user/ui/SessionCard.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  useHeadSeo({
    subTitle: 'Устройство',
    description: 'Сведения об устройстве и его переименование.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-xl">
  {#if data.fact || data.enabled === false}
    <Acl status={data.fact} enabled={data.enabled} backHref={userSessionsRoute.href()} />
  {:else if data.detail}
    <div class="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
      <h1 class="mb-4 text-lg font-semibold leading-tight tracking-tight">Устройство</h1>
      <SessionCard detail={data.detail} notice={data.notice} backHref={userSessionsRoute.href()} />
    </div>
  {:else}
    <Acl status="auth.session-unknown" backHref={userSessionsRoute.href()} />
  {/if}
</div>
