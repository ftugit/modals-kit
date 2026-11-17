<script lang="ts">
  /**
   * Выход в модалке (`user.logout`). Данные — тот же `load`, что у
   * `/user/logout`; носитель только отдаёт их компоненту.
   */
  import { useLoader } from '#core/lib/modals/svelte/index.js'
  import { Surface } from '#core/ui/index.js'
  import type { LogoutRouteData } from '../model/types.js'
  import Logout from './logout/Logout.svelte'

  const ldr = useLoader<LogoutRouteData>()
</script>

<Surface variant="plain" scroll={false} class="flex min-h-0 flex-1 flex-col w-full p-6">
  {#if ldr.data}
    <Logout
      sessionId={ldr.data.sessionId}
      total={ldr.data.total}
      canRevoke={ldr.data.canRevoke}
      mode="modal"
      class="max-w-none"
    />
  {/if}
</Surface>
