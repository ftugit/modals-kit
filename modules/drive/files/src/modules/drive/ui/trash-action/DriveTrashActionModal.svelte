<script lang="ts">
  /** Модалка «trash-action»: тонкий носитель над загрузчиком /drive/trash-action. */
  import { useLoader } from '#core/lib/modals/svelte/index.js'
  import { Surface } from '#core/ui/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import type { DriveOperationData } from '../../types.js'
  import DriveTrashAction from './DriveTrashAction.svelte'

  const ldr = useLoader<DriveOperationData>()
</script>

<Surface variant="plain" class="flex w-full flex-col p-6">
  {#if ldr.data?.fact}
    <Acl status={ldr.data.fact} enabled={ldr.data.enabled} backHref="/drive" variant="plain" />
  {:else if ldr.data}
    <DriveTrashAction initial={ldr.data} />
  {/if}
</Surface>
