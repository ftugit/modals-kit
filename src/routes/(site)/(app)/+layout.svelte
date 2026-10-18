<script lang="ts">
  // Ветка сайта с глобальной модальной системой: globalScope и базовая пара
  // носителей url+local (deep-link'и работают на всех страницах сайта).
  // Модалки пользователя регистрирует `./auth-modals` — статический импорт:
  // deep-link должен разрешаться уже при создании хоста.
  import './auth-modals'
  import { globalScope } from '#lib/modals/index.js'
  import ModalSystem from '../ModalSystem.svelte'

  let { children } = $props()

  const SOURCES = ['url', 'local'] as const
</script>

<ModalSystem scope={globalScope} sources={() => SOURCES}>
  {@render children()}
</ModalSystem>
