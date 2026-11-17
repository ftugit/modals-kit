<script lang="ts">
  /** Корзина в модалке (`drive.trash`). */
  import { invalidateAll } from '$app/navigation'
  import { useLoader, useModals } from '#core/lib/modals/svelte/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import type { DrivePageData } from '../types.js'
  import DriveBrowse from './DriveBrowse.svelte'

  const m = useModals()
  const ldr = useLoader<DrivePageData>()
  const data = $derived(ldr.data)
</script>

{#if data?.fact}
  <Acl status={data.fact} backHref="/" variant="plain" />
{:else if data}
  <DriveBrowse
    initial={data}
    variant="plain"
    onDone={() => {
      void invalidateAll()
      m.modals.close()
      m.modals.invalidateLoader('drive.trash')
    }}
  />
{/if}
