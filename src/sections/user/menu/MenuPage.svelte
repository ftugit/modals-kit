<script lang="ts">
  // Страница меню пользователя — section-компонент (тонкий носитель в route).
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import MenuBody from '#modules/user/base/svelte/MenuBody.svelte'

  useHeadSeo({
    subTitle: 'Аккаунт',
    description: 'Меню управления текущим аккаунтом и сессией.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-sm">
  <h1 class="mb-4 text-base font-semibold">Аккаунт</h1>
  <MenuBody variant="card" />
</div>
