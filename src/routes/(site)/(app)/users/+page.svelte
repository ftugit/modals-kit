<script lang="ts">
  // Страница списка seed-юзеров — только носитель: ACL-гейт по данным
  // `load`, дальше показывает компонент списка с данными того же `load`
  // (свой запрос ему не нужен). Отказ о правах говорит носитель — как в
  // модалке, поэтому формы отказа разойтись не могут.
  import Acl from '#content/user/ui/Acl.svelte'
  import SeedUsersList from '#content/user/ui/SeedUsersList.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<svelte:head><title>Seed-юзеры</title></svelte:head>

<div class="mx-auto w-full max-w-2xl">
  {#if data.fact === 'auth.forbidden'}
    <Acl model="forbidden" backHref="/" />
  {:else if data.fact}
    <Acl status={data.fact} backHref="/" />
  {:else}
    <SeedUsersList initial={data} />
  {/if}
</div>
