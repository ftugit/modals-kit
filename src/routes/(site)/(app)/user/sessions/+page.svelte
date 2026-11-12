<script lang="ts">
  // Страница своих сессий — тот же список, что модалка `user.sessions`.
  // Носитель только гейтит отказ: `Acl` по данным `load`, дальше показывает
  // список с данными того же `load` (свой запрос ему не нужен).
  import { useHeadSeo } from '#components/shell/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import SessionsList from '#content/user/ui/SessionsList.svelte'
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
  {:else}
    <SessionsList initial={data} variant="card" sidebar="middle" />
  {/if}
</div>
