<script lang="ts">
  // Журнал сессий (`/sessions`) — только носитель: ACL-гейт по данным `load`,
  // дальше тот же `SessionsList`, что у своих устройств, с флагом `journal`.
  import { useHeadSeo } from '#components/shell/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import SessionsList from '#content/user/ui/SessionsList.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  useHeadSeo({
    subTitle: 'Все сессии',
    description: 'Сессии всех аккаунтов, которые доступны на чтение.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-2xl">
  {#if data.fact || data.enabled === false}
    <Acl status={data.fact} enabled={data.enabled} backHref="/" />
  {:else}
    <SessionsList target={data.target} initial={data} variant="card" sidebar="middle" />
  {/if}
</div>
