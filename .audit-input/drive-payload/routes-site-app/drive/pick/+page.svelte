<script lang="ts">
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import { DrivePicker } from '#modules/drive/index.js'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<div class="mx-auto w-full max-w-3xl">
  {#if data.browse.fact}
    <Acl status={data.browse.fact} enabled={data.browse.enabled} backHref={data.from} />
  {:else}
    <DrivePicker
      initial={data.browse}
      from={data.from}
      param={data.param}
      kind={data.kind}
      folderId={data.folderId}
    />
  {/if}
</div>
