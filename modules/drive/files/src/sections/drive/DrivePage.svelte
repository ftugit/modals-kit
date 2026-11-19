<script lang="ts">
  // Страница «Диска»: гейт входа и общий проводник поверх нативного `Listing`.
  import { untrack } from 'svelte'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import { DriveBrowse } from '#modules/drive/index.js'
  import type { DriveListRouteData } from '#modules/drive/types.js'

  interface Props {
    data: DriveListRouteData
    title?: string
  }

  let { data, title = 'Диск' }: Props = $props()

  useHeadSeo({
    subTitle: untrack(() => title),
    description: 'Файлы и папки диска: список, размер, дата изменения и квота.',
    noindex: true,
  })
</script>

<div class="mx-auto flex w-full max-w-3xl flex-col">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref="/" />
  {:else}
    <DriveBrowse initial={data} sidebar="middle" />
  {/if}
</div>
