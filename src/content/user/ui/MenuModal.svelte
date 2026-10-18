<script lang="ts">
  /**
   * Меню авторизованного в модалке (`?modal=user.menu`). Тело — общий компонент
   * `MenuBody` (тот же, что у страницы `/user/menu`; решение владельца, ход 261).
   * Модалка зарегистрирована БЕЗ `route`, поэтому `useLoader` здесь данных не
   * даёт — тело рисуется сразу (профиль берёт из vault), `next` — по умолчанию.
   */
  import { goto } from '$app/navigation'
  import { useModals } from '#lib/modals/svelte/index.js'
  import MenuBody from './MenuBody.svelte'

  const m = useModals()
</script>

<MenuBody
  onDone={() => {
    m.modals.close()
    void goto('/')
  }}
/>
