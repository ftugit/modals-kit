<script lang="ts">
  /** Доступы узла в модалке (`drive.access`): тонкий носитель над `/drive/access`. */
  import { invalidateAll } from '$app/navigation'
  import { useLoader, useModals } from '#core/lib/modals/svelte/index.js'
  import { Button, Surface } from '#core/ui/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import type { DriveNodePageData } from '../../types.js'
  import { driveAccessRoute, driveRootRoute } from '../../routes.js'
  import DriveAccess from './DriveAccess.svelte'

  const m = useModals()
  const ldr = useLoader<DriveNodePageData>()
  const data = $derived(ldr.data)
  const returnTo = $derived(
    data?.node ? driveAccessRoute.href({ node_id: data.node.id }) : driveRootRoute.href(),
  )
</script>

<Surface variant="plain" class="flex w-full flex-col gap-4 p-4 sm:p-6">
  {#if data?.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref={returnTo} variant="plain" />
  {:else if data?.node}
    <DriveAccess {data} {returnTo} />
    <div class="flex justify-end">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onclick={() => {
          void invalidateAll()
          m.modals.close()
          m.modals.invalidateLoader('drive.access')
        }}
      >
        Закрыть
      </Button>
    </div>
  {/if}
</Surface>
