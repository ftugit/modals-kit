<script lang="ts">
  // Страница выхода — носитель: компонент тот же, что в модалке `user.logout`.
  // Отказа здесь нет по определению: выйти вправе и тот, чей токен протух.
  import { useHeadSeo } from '#components/shell/index.js'
  import Logout from '#content/user/ui/logout/Logout.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  useHeadSeo({
    subTitle: 'Выход',
    description: 'Выход из аккаунта на этом или на всех устройствах.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-sm">
  <Logout
    sessionId={data.sessionId}
    total={data.total}
    canRevoke={data.canRevoke}
    variant="card"
    backHref="/user/logout"
  />
</div>
