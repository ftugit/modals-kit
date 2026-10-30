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

  const modalData = $derived(
    ldr.data
      ? {
          ...ldr.data,
          step: resolveAuthStep(modal.params?.stage) ?? ldr.data.step,
        }
      : null,
  )

  function done() {
    // Вход мог состояться поверх уже открытых модалок с данными маршрута
    // (список seed-юзеров, его фильтры, профиль): их loader-кеш собран до
    // смены сессии и после возврата показывал бы старый отказ и старые
    // права. Сбрасываем кеш ДО закрытия auth: когда запись снизу снова
    // станет активной, хост перезапустит её loader по свежей сессии.
    m.modals.invalidateLoader()
    m.modals.close()
  }
</script>

{#if modalData}
  <div class="my-auto w-full p-6">
    <AuthWidget
      data={modalData}
      mode="modal"
      variant="plain"
      onDone={done}
    />
  </div>
{/if}
