<script lang="ts">
  /**
   * Карточка устройства в модалке (`user.session`). Данные — тот же `load`,
   * что у `/user/sessions/<id>` (с `uid` — у `/user/[id]/sessions/[sessionId]`).
   * Пока их нет, оболочку не рисуем: скелетон ядра остаётся на время загрузки,
   * пустой кадр не подменяем своим.
   */
  import { useLoader, useModal } from '#lib/modals/svelte/index.js'
  import { Surface } from '#components/ui/index.js'
  import type { AuthErrorCode } from '../error.js'
  import type { SessionDetail } from '../types.js'
  import { userAccountSessionsRoute, userSessionsRoute } from '../routes.js'
  import Acl from './Acl.svelte'
  import SessionCard from './SessionCard.svelte'

  interface CardLoaderData {
    enabled: boolean
    fact: AuthErrorCode | null
    detail: SessionDetail | null
    notice: 'rename-failed' | null
  }

  const ldr = useLoader<CardLoaderData>()
  const modal = useModal<{ id?: string; uid?: string }>()
  // Возврат — в список той же цели: устройство чужого аккаунта уходит в
  // `/user/[id]/sessions`, а не в свой список.
  const uid = $derived(modal.params?.uid ? String(modal.params.uid) : null)
  const backHref = $derived(uid ? userAccountSessionsRoute.href({ id: uid }) : userSessionsRoute.href())
</script>

<Surface variant="plain" class="w-full p-6" title="Устройство">
  {#if ldr.data && (ldr.data.enabled === false || ldr.data.fact || !ldr.data.detail)}
    <Acl status={ldr.data.fact} enabled={ldr.data.enabled} {backHref} variant="plain" />
  {:else if ldr.data?.detail}
    <SessionCard
      detail={ldr.data.detail}
      notice={ldr.data.notice}
      {backHref}
      mode="modal"
    />
  {/if}
</Surface>
