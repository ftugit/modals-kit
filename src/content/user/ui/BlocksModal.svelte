<script lang="ts">
  /**
   * Модалка списка блокировок (`user.blocks`): носитель и ACL-гейт.
   * При переданном `params.id` показывает блокировки этого пользователя,
   * без `id` — глобальный список блокировок. Данные приносит загрузчик
   * записи (тот же `load` роута) и отдаёт списку пропсом `initial`.
   */
  import { useLoader, useModal } from '#lib/modals/svelte/index.js'
  import Acl from './Acl.svelte'
  import BlocksList from './BlocksList.svelte'
  import type { AuthErrorCode } from '../error.js'
  import type { BlocksRouteData } from './blocks-list/source.js'
  import { Surface } from '#components/ui/index.js'

  const modal = useModal<{ id?: string }>()
  const ldr = useLoader<BlocksRouteData>()
  const uid = $derived(modal.params?.id ? String(modal.params.id) : null)
  let acl = $state<AuthErrorCode | null>(null)
  const effectiveAcl = $derived(acl ?? ldr.data?.fact ?? null)
</script>

<Surface variant="plain" scroll={false} class="flex min-h-0 flex-1 flex-col w-full p-6">
  {#if ldr.data?.enabled === false || effectiveAcl}
    <Acl status={effectiveAcl} enabled={ldr.data?.enabled} backHref="/" variant="plain" />
  {:else}
    <BlocksList
      {uid}
      initial={ldr.data}
      variant="plain"
      class="min-h-0 flex-1"
      onAcl={(fact) => (acl = fact)}
    />
  {/if}
</Surface>
