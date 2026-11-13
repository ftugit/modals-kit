<script lang="ts">
  // Карточка устройства чужого аккаунта — fallback модалки `user.session`
  // с целью. Возврат ведёт в список устройств того же аккаунта, поэтому
  // адрес берётся из реестра, а не собирается из сегментов.
  import { useHeadSeo } from '#components/shell/index.js'
  import { userAccountSessionRoute, userAccountSessionsRoute } from '#content/user/routes.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import SessionCard from '#content/user/ui/SessionCard.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
  const backHref = $derived(userAccountSessionsRoute.href({ id: data.uid }))
  const renameAction = $derived(
    data.detail ? `${userAccountSessionRoute.href({ id: data.uid, sessionId: data.detail.session.id })}?/rename` : undefined,
  )

  useHeadSeo({
    subTitle: 'Устройство аккаунта',
    description: 'Сведения об устройстве выбранного аккаунта и его переименование.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-xl">
  {#if data.fact || data.enabled === false}
    <Acl status={data.fact} enabled={data.enabled} {backHref} />
  {:else if data.detail}
    <div class="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
      <h1 class="mb-4 text-lg font-semibold leading-tight tracking-tight">Устройство аккаунта</h1>
      <SessionCard detail={data.detail} notice={data.notice} {backHref} actionHref={renameAction} />
    </div>
  {:else}
    <Acl status="auth.session-unknown" {backHref} />
  {/if}
</div>
