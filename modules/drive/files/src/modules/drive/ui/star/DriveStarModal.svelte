<script lang="ts">
  /** Модалка «star»: тонкий носитель над загрузчиком /drive/star. */
  import { useLoader } from '#core/lib/modals/svelte/index.js'
  import { Surface } from '#core/ui/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import type { DriveOperationData } from '../../types.js'
  import DriveStar from './DriveStar.svelte'

  const ldr = useLoader<DriveOperationData>()
</script>

<Surface variant="plain" class="flex w-full flex-col p-6">
  {#if ldr.data?.fact}
    <Acl status={ldr.data.fact} enabled={ldr.data.enabled} backHref="/drive" variant="plain" />
  {:else if ldr.data}
    <DriveStar initial={ldr.data} />
  {/if}
</Surface>
