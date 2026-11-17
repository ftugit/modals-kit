<script lang="ts">
  /** Карточка узла (`drive.node`): тонкий носитель над загрузчиком `/drive/node/[id]`. */
  import { invalidateAll } from '$app/navigation'
  import { useLoader, useModals } from '#core/lib/modals/svelte/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import { Button, Surface } from '#core/ui/index.js'
  import type { DrivePageData } from '../types.js'
  import DriveNodeCard from './DriveNodeCard.svelte'
  import DriveNodeActions from './DriveNodeActions.svelte'
  import DriveAccess from './DriveAccess.svelte'
  import { driveFolderRoute, driveNodeRoute } from '../routes.js'

  const m = useModals()
  const ldr = useLoader<DrivePageData>()
  const data = $derived(ldr.data)
</script>

<Surface variant="plain" class="flex min-h-0 flex-1 flex-col w-full p-6">
  {#if data?.fact}
    <Acl status={data.fact} backHref="/" variant="plain" />
  {:else if data?.node}
    <div class="flex flex-col gap-4">
      <DriveNodeCard entry={{ node: data.node, caps: data.caps }} variant="detail" />
      <DriveNodeActions
        nodeId={data.node.id}
        name={data.node.name}
        starred={data.node.starred}
        canWrite={data.caps.canWrite}
        canShare={data.caps.canShare}
        trashed={data.node.trashedAt !== null}
        folders={[]}
        returnTo={driveNodeRoute.href({ id: data.node.id })}
      />
      {#if data.caps.canShare}
        <DriveAccess
          nodeId={data.node.id}
          shares={data.shares}
          returnTo={driveNodeRoute.href({ id: data.node.id })}
        />
      {/if}
      {#if data.node.kind === 'folder'}
        <Button href={driveFolderRoute.href({ folderId: data.node.id })} variant="outline" size="sm">
          Открыть папку
        </Button>
      {/if}
      <div class="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          onclick={() => {
            void invalidateAll()
            m.modals.close()
            m.modals.invalidateLoader('drive.node')
          }}
        >
          Закрыть
        </Button>
      </div>
    </div>
  {/if}
</Surface>
