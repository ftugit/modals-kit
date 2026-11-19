<script lang="ts">
  /** Пикер в модалке (`drive.picker`): тот же экран, что `/drive/pick`. */
  import { useLoader, useModals } from '#core/lib/modals/svelte/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import type { DrivePickerData } from '../types.js'
  import DrivePicker from './DrivePicker.svelte'
  import { drivePickerChannel, type DriveTargetPicked } from './operation/picker-channel.js'

  const m = useModals()
  const ldr = useLoader<DrivePickerData>()
  const data = $derived(ldr.data)

  function pick(id: string | null, label: string) {
    if (!data) return
    const payload: DriveTargetPicked = { seq: Date.now(), id, label }
    m.modals.store.merge('sharedData', { [drivePickerChannel(data.param)]: payload })
    m.modals.invalidateLoader('drive.picker')
    m.modals.close()
  }
</script>

{#if data?.list.fact}
  <Acl status={data.list.fact} enabled={data.list.enabled} backHref={data.from} variant="plain" />
{:else if data}
  <DrivePicker initial={data} onPick={pick} onCancel={() => m.modals.close()} />
{/if}
