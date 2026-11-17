<script lang="ts">
  // Страница выхода — section-компонент (тонкий носитель в route).
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import Logout from '#modules/user/base/svelte/logout/Logout.svelte'
  import type { LogoutRouteData } from '#modules/user/base/model/types.js'

  let { data }: { data: LogoutRouteData } = $props()

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
    backHref="/"
  />
</div>
