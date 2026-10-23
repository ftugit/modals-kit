<script lang="ts">
  /**
   * Меню авторизованного в модалке (`?modal=user.menu`). Тело — общий компонент
   * `MenuBody` (тот же, что у страницы `/user/menu`; решение владельца, ход 261).
   * Модалка зарегистрирована БЕЗ `route`, поэтому `useLoader` здесь данных не
   * даёт — тело рисуется сразу (профиль берёт из реактивного `vault`).
   */
  import { useModals } from '#lib/modals/svelte/index.js'
  import MenuBody from './MenuBody.svelte'

  const m = useModals()
</script>

<MenuBody variant="plain" class="p-5" onDone={() => m.modals.close()} />
