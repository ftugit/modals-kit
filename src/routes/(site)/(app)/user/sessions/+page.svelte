<script lang="ts">
  // Страница своих сессий — тот же список, что модалка `user.sessions`.
  import { useHeadSeo } from '#components/shell/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import SessionsView from '#content/user/ui/SessionsView.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  useHeadSeo({
    subTitle: 'Сессии',
    description: 'Устройства, с которых выполнен вход в аккаунт.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-2xl">
  {#if data.fact || data.enabled === false}
    <Acl status={data.fact} enabled={data.enabled} backHref="/" />
  {:else if data.page}
    <SessionsView page={data.page} notice={data.notice} variant="card" />
  {:else}
    <Acl status="auth.forbidden" backHref="/" />
  {/if}
</div>
