<script lang="ts">
  /**
   * Виджет авторизации в модалке (`?modal=user.auth`). Данные загрузчика
   * маршрута — через `useLoader()`. Callback — закрытие модалки.
   */
  import { useLoader, useModals } from '#lib/modals/svelte/index.js'
  import AuthWidget from './AuthWidget.svelte'

  type RouteData = {
    challenge: { nonce: string; expiresAt: number } | null
    next: string | null
    step: string
    registerSeed: string | null
    enabled?: boolean
    limits: { edge: number; maxBytes: number; formats: string[]; holdSeconds: number }
    user?: { prof: { nickname: string | null; avatarUrl: string | null } } | null
  }

  const m = useModals()
  const ldr = useLoader<RouteData>()
</script>

<div class="p-5">
  {#if ldr.data}
    <AuthWidget data={ldr.data} mode="modal" onDone={() => m.modals.close()} />
  {/if}
</div>
