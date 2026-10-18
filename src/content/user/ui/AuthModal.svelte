<script lang="ts">
  /**
   * Виджет авторизации в модалке (`?modal=user.auth`). Данные загрузчика
   * маршрута — через `useLoader()` (контракт `ModalContent`: проп `data` —
   * это sharedData, а данные записи отдаются хуком; паттерн — `CardModal`).
   * Скелетон до готовности рисует хост, поэтому на момент рендера данные
   * уже загружены. Callback — закрытие именно модалки (решение владельца).
   */
  import { useLoader, useModals } from '#lib/modals/svelte/index.js'
  import AuthWidget from './AuthWidget.svelte'

  type RouteData = {
    challenge: { nonce: string; expiresAt: number } | null
    next: string | null
    step: string
    registerSeed: string | null
    limits: { edge: number; maxBytes: number; formats: string[]; holdSeconds: number }
    user?: { prof: { nickname: string | null; avatarUrl: string | null } } | null
  }

  const m = useModals()
  const ldr = useLoader<RouteData>()
</script>

<div class="p-5">
  {#if ldr.data}
    <AuthWidget data={ldr.data} form={null} mode="modal" actionUrl="/user/auth" onDone={() => m.modals.close()} />
  {/if}
</div>
