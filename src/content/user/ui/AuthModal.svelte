<script lang="ts">
  /**
   * Виджет авторизации в модалке (`?modal=user.auth`). Данные загрузчика
   * маршрута — через `useLoader()`, целевой шаг (`stage`) — из параметров
   * записи модалки (`useModal().params.stage`). Состояние пользователя —
   * напрямую из единого реактивного `vault`.
   */
  import { useLoader, useModal, useModals } from '#lib/modals/svelte/index.js'
  import { resolveAuthStep } from '../index.js'
  import type { ProfileLimits } from './profile-form/index.js'
  import AuthWidget from './AuthWidget.svelte'

  type RouteData = {
    challenge: { nonce: string; expiresAt: number } | null
    next: string | null
    step: string
    registerSeed: string | null
    enabled?: boolean
    limits: ProfileLimits & { holdSeconds: number }
  }

  const m = useModals()
  const modal = useModal<{ stage?: string }>()
  const ldr = useLoader<RouteData>()

  const modalData = $derived(
    ldr.data
      ? {
          ...ldr.data,
          step: resolveAuthStep(modal.params?.stage) ?? ldr.data.step,
        }
      : null,
  )
</script>

{#if modalData}
  <AuthWidget
    data={modalData}
    mode="modal"
    variant="plain"
    class="p-5"
    onDone={() => m.modals.close()}
  />
{/if}
