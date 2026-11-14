<script lang="ts">
  /**
   * Модалка единицы закрытия устройств (`user.session.delete`): носитель и
   * ACL-гейт. Один ключ на два адреса — свой аккаунт и переданная цель
   * (`uid`); набор и вариант приходят параметрами.
   *
   * После успеха слой не закрывается самовольно: компонент показывает
   * результат, а закрывает модалку человек (правило §6.1).
   */
  import { useLoader, useModal } from '#lib/modals/svelte/index.js'
  import Acl from './Acl.svelte'
  import SessionDelete from './session-delete/SessionDelete.svelte'
  import type { SessionDeleteRouteData } from '../types.js'
  import { parseSessionDeleteVariant, type SessionDeleteVariant } from '../session-delete.js'
  import { userAccountSessionsRoute, userSessionsRoute } from '../routes.js'
  import { Surface } from '#components/ui/index.js'

  const modal = useModal<{ id?: string; ids?: string; variant?: string; uid?: string }>()
  const ldr = useLoader<SessionDeleteRouteData>()

  const ids = $derived(
    String(modal.params?.ids ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  )
  const variant = $derived<SessionDeleteVariant>(parseSessionDeleteVariant(modal.params?.variant))
  const uid = $derived(modal.params?.uid ? String(modal.params.uid) : null)
  // Адрес списка — из реестра, а не строкой: стража путей не пропускает литералы.
  const listHref = $derived(uid ? userAccountSessionsRoute.href({ id: uid }) : userSessionsRoute.href())
</script>

<Surface variant="plain" class="w-full p-6">
  {#if ldr.data?.fact}
    <Acl status={ldr.data.fact} enabled={ldr.data.enabled} backHref={listHref} variant="plain" />
  {:else}
    <SessionDelete
      {ids}
      {variant}
      initial={ldr.data ?? null}
      doneHref={listHref}
      class="p-0"
    />
  {/if}
</Surface>
