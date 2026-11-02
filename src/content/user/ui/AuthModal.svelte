<script lang="ts">
  /**
   * Виджет авторизации в модалке (`?modal=user.auth`). Данные загрузчика
   * маршрута — через `useLoader()`, целевой шаг (`stage`) — из параметров
   * записи модалки (`useModal().params.stage`). Состояние пользователя —
   * напрямую из единого реактивного `vault`.
   */
  import { useLoader, useModal, useModalData, useModals } from '#lib/modals/svelte/index.js'
  import { vault, type VaultPayload } from '../vault.svelte.js'
  import { resolveAuthStep } from '../index.js'
  import type { ProfileLimits } from './profile-form/index.js'
  import AuthWidget from './AuthWidget.svelte'
  import { Surface } from '#components/ui/index.js'

  type RouteData = {
    challenge: { token: string; expiresAt: number } | null
    next: string | null
    step: string
    registerSeed: string | null
    enabled?: boolean
    limits: ProfileLimits & { holdSeconds: number }
  }

  const m = useModals()
  const modal = useModal<{ stage?: string }>()
  const ldr = useLoader<RouteData>()
  type PendingStep = {
    principal: string
    step: 'profile' | 'restrictions'
    restrictions?: readonly { scope: string; reason: string; untilMs: number | null }[]
  }
  const pending = useModalData<PendingStep>()
  const pendingForPrincipal = $derived(
    pending.value?.principal === vault.principal ? pending.value : undefined,
  )
  // Ограничения принадлежат конкретной сессии, а не позиции стопки.
  $effect(() => {
    if (pending.value && pending.value.principal !== vault.principal) pending.value = undefined
  })

  const modalData = $derived(
    ldr.data
      ? {
          ...ldr.data,
          step: pendingForPrincipal?.step ?? resolveAuthStep(modal.params?.stage) ?? ldr.data.step,
          restrictions: pendingForPrincipal?.restrictions,
        }
      : null,
  )

  function rememberStep(next: {
    step?: string
    user?: VaultPayload
    restrictions?: readonly { scope: string; reason: string; untilMs: number | null }[]
  }) {
    if (next.user && (next.step === 'profile' || next.step === 'restrictions')) {
      pending.value = { principal: next.user.sub, step: next.step, restrictions: next.restrictions }
    }
  }

  function done() {
    pending.value = undefined
    m.modals.close()
  }
</script>

{#if modalData}
  <Surface variant="plain" class="w-full p-6">
    <AuthWidget
      data={modalData}
      mode="modal"
      variant="plain"
      onDone={done}
      onAuthenticatedStep={rememberStep}
    />
  </Surface>
{/if}
