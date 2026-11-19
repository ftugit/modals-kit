<script lang="ts">
  import DriveShare from '#modules/drive/ui/share/DriveShare.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<div class="mx-auto w-full max-w-xl">
  <div class="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
    <DriveShare initial={data} />
  </div>
</div>
