<script lang="ts">
  // Страница доступов узла — fallback модалки `drive.access` без JS.
  import { untrack } from 'svelte'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import { Button, Surface } from '#core/ui/index.js'
  import { asLink } from '#core/hooks/links/index.js'
  import DriveAccess from '#modules/drive/ui/access/DriveAccess.svelte'
  import { driveAccessRoute, driveRootRoute } from '#modules/drive/routes.js'
  import type { DriveNodePageData } from '#modules/drive/types.js'

  let { data }: { data: DriveNodePageData } = $props()

  const returnTo = $derived(
    data.node ? driveAccessRoute.href({ node_id: data.node.id }) : driveRootRoute.href(),
  )

  useHeadSeo({
    subTitle: untrack(() => (data.node ? `Доступы: ${data.node.name}` : 'Доступы')),
    description: 'Кому выдан доступ к файлу или папке диска.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-2xl">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref="/" />
  {:else if data.node}
    <Surface title="Доступы" description="Кому выдан доступ к узлу и его поддереву.">
      <div class="flex flex-col gap-4">
        <DriveAccess {data} {returnTo} />
        <Button {...asLink(driveRootRoute.href())} variant="ghost" size="sm">К диску</Button>
      </div>
    </Surface>
  {/if}
</div>
