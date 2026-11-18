<script lang="ts">
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import { DrivePicker } from '#modules/drive/index.js'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<div class="mx-auto flex w-full max-w-3xl flex-col">
  {#if data.list.fact}
    <Acl status={data.list.fact} enabled={data.list.enabled} backHref={data.from} />
  {:else}
    <DrivePicker initial={data} />
  {/if}
</div>
