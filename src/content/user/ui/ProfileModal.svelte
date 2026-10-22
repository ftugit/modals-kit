<script lang="ts">
  /**
   * Редактирование профиля в модалке (`?modal=user.profile`). Данные берутся
   * загрузчиком маршрута `/user/profile` через `useLoader()`, а POST формы
   * идёт прямо на текущий маршрут под модалкой (`bindRouteForm`).
   */
  import { useLoader, useModals } from '#lib/modals/svelte/index.js'
  import ProfileForm from './ProfileForm.svelte'

  type RouteData = {
    user: { prof: { nickname: string | null; avatarUrl: string | null } }
    next: string | null
    limits: { edge: number; maxBytes: number; formats: string[] }
  }

  const m = useModals()
  const ldr = useLoader<RouteData>()
</script>

<div class="p-5">
  {#if ldr.data}
    <ProfileForm
      limits={ldr.data.limits}
      initial={ldr.data.user.prof}
      doneHref={ldr.data.next ?? '/'}
      onDone={() => m.modals.close()}
    />
  {/if}
</div>
