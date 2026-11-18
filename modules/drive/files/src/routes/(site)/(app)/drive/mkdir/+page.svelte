<script lang="ts">
  import DriveMkdir from '#modules/drive/ui/mkdir/DriveMkdir.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<div class="mx-auto w-full max-w-xl">
  <div class="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
    <DriveMkdir initial={data} />
  </div>
</div>
