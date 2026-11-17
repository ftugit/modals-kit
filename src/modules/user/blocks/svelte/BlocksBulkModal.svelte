<script lang="ts">
  /**
   * Модалка единицы наборных действий над блокировками (`user.blocks.bulk`):
   * носитель и ACL-гейт. Набор — отмеченные строки (`ids`) или срез списка
   * (`list`).
   *
   * После успеха слой не закрывается самовольно: компонент показывает числа
   * исхода, закрывает человек.
   */
  import { useLoader, useModal } from '#core/lib/modals/svelte/index.js'
  import { Surface } from '#core/ui/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import BlocksBulk from './blocks-bulk/BlocksBulk.svelte'
  import type { BlocksBulkRouteData } from '#modules/user/base/model/types.js'
  import { blocksListRoute } from '#modules/user/base/routes.js'

  const modal = useModal<{ list?: string; ids?: string }>()
  const ldr = useLoader<BlocksBulkRouteData>()

  const ids = $derived(
    String(modal.params?.ids ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  )
  const listHref = blocksListRoute.href()
</script>

<Surface variant="plain" class="w-full p-6">
  {#if ldr.data?.fact}
    <Acl status={ldr.data.fact} enabled={ldr.data.enabled} backHref={listHref} variant="plain" />
  {:else}
    <BlocksBulk
      {ids}
      sliceFields={ldr.data?.sliceFields ?? null}
      initial={ldr.data ?? null}
      doneHref={listHref}
      class="p-0"
    />
  {/if}
</Surface>
