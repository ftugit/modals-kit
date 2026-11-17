<script lang="ts">
  // Страница авторизации — section-компонент (тонкий носитель в route).
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import AuthWidget from '#modules/user/base/svelte/AuthWidget.svelte'
  import type { UserAuthRouteData } from './types.js'

  let { data }: { data: UserAuthRouteData } = $props()

  useHeadSeo({
    subTitle: 'Авторизация',
    description: 'Вход и регистрация аккаунта по seed-фразе.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-sm">
  <h1 class="mb-4 text-xl font-semibold">Вход</h1>
  <AuthWidget {data} mode="page" variant="card" />
</div>
