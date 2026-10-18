<script lang="ts">
  // Ветка сайта с глобальной модальной системой: globalScope и базовая пара
  // носителей url+local (deep-link'и работают на всех страницах сайта).
  import { globalScope } from '#lib/modals/index.js'
  import ModalSystem from '../ModalSystem.svelte'

  // Модалки пользователя (user.auth, user.menu) — ленивой регистрацией
  // (`./auth-modals`): виджет авторизации не едет в чанк раскладки.
  $effect(() => {
    void import('./auth-modals')
  })

  let { children } = $props()

  const SOURCES = ['url', 'local'] as const
</script>

<ModalSystem scope={globalScope} sources={() => SOURCES}>
  {@render children()}
</ModalSystem>
