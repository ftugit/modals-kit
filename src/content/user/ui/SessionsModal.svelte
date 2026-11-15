<script lang="ts">
  /**
   * Устройства в модалке (`user.sessions`): свои — без параметров, аккаунта —
   * с `id`. Данные — тот же `load`, что у страницы-фallback (`/user/sessions`
   * или `/user/[id]/sessions`); список — общий `SessionsList` с фильтрами.
   * Пока данных нет, оболочку не рисуем: скелетон ядра остаётся на время
   * загрузки, пустой кадр не подменяем своим.
   */
  import { useLoader, useModal } from '#lib/modals/svelte/index.js'
  import { Surface } from '#components/ui/index.js'
  import type { SessionsRouteData, SessionsTarget } from '../types.js'
  import Acl from './Acl.svelte'
  import SessionsList from './SessionsList.svelte'

  const modal = useModal<{ id?: string }>()
  const ldr = useLoader<SessionsRouteData>()
  // Цель списка — `id` модалки, а не адрес носителя. Без `id` — свои устройства.
  const target = $derived<SessionsTarget>(
    modal.params?.id ? { kind: 'account', uid: String(modal.params.id) } : { kind: 'own' },
  )
  // Данные `load` — только своей цели: чужой срез не должен на один тик показать
  // устройства другого аккаунта.
  const initial = $derived(
    ldr.data &&
      ldr.data.target.kind === target.kind &&
      (target.kind !== 'account' || (ldr.data.target.kind === 'account' && ldr.data.target.uid === target.uid))
      ? ldr.data
      : null,
  )
</script>

<Surface variant="plain" scroll={false} class="flex min-h-0 flex-1 flex-col w-full p-6">
  {#if ldr.data?.enabled === false || ldr.data?.fact}
    <Acl status={ldr.data?.fact} enabled={ldr.data?.enabled} backHref="/" variant="plain" />
  {:else if ldr.data}
    {#key target.kind === 'account' ? target.uid : target.kind}
      <SessionsList {target} {initial} mode="modal" url={false} variant="plain" class="min-h-0 flex-1" />
    {/key}
  {/if}
</Surface>
