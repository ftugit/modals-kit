<script lang="ts">
  /** Модалка «restore»: тонкий носитель над загрузчиком /drive/restore. */
  import { useLoader } from '#core/lib/modals/svelte/index.js'
  import { Surface } from '#core/ui/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import { driveRootRoute } from '../../routes.js'
  import type { DriveOperationData } from '../../types.js'
  import DriveRestore from './DriveRestore.svelte'

  const ldr = useLoader<DriveOperationData>()
</script>

<Surface variant="plain" class="flex w-full flex-col p-4 sm:p-6">
  {#if ldr.data?.fact}
    <Acl status={ldr.data.fact} enabled={ldr.data.enabled} backHref={driveRootRoute.href()} variant="plain" />
  {:else if ldr.data}
    <DriveRestore initial={ldr.data} />
  {/if}
</Surface>
