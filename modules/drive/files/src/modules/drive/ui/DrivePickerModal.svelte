<script lang="ts">
  /** Пикер в модалке (`drive.picker`): тот же экран, что `/drive/pick`. */
  import { invalidateAll } from '$app/navigation'
  import { useLoader, useModals } from '#core/lib/modals/svelte/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import { Button } from '#core/ui/index.js'
  import type { DrivePickerData } from '../types.js'
  import DrivePicker from './DrivePicker.svelte'

  const m = useModals()
  const ldr = useLoader<DrivePickerData>()
  const data = $derived(ldr.data)
</script>

{#if data?.list.fact}
  <Acl status={data.list.fact} enabled={data.list.enabled} backHref={data.from} variant="plain" />
{:else if data}
  <DrivePicker initial={data} />
  <div class="flex justify-end p-2">
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onclick={() => {
        void invalidateAll()
        m.modals.close()
        m.modals.invalidateLoader('drive.picker')
      }}
    >
      Закрыть
    </Button>
  </div>
{/if}
