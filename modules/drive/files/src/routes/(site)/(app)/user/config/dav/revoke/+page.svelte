<script lang="ts">
  import DriveDavRevoke from '#modules/drive/ui/dav-revoke/DriveDavRevoke.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<div class="mx-auto w-full max-w-xl">
  <div class="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
    <DriveDavRevoke initial={data} />
  </div>
</div>
