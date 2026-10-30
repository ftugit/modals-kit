<script lang="ts">
  /**
   * Меню авторизованного в модалке (`?modal=user.menu`) — узкая ширина и
   * прямые ссылки. Тело — общий компонент `MenuBody` (тот же, что у страницы
   * `/user/menu`; решение владельца, ход 261). На широкой ширине шапка вместо
   * модалки открывает всплывашку с тем же телом и адрес не трогает (см.
   * `UserMenu`). Тело рисуется сразу: профиль берёт из реактивного `vault`,
   * данные маршрута меню не нужны.
   */
  import { useModals } from '#lib/modals/svelte/index.js'
  import MenuBody from './MenuBody.svelte'

  const m = useModals()
</script>

<div class="my-auto w-full p-6">
  <MenuBody variant="plain" onDone={() => m.modals.close()} />
</div>
