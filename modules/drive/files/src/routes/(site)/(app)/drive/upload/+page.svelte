<script lang="ts">
  import DriveUpload from '#modules/drive/ui/upload/DriveUpload.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<div class="mx-auto w-full max-w-xl">
  <div class="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
    <DriveUpload initial={data} />
  </div>
</div>
