<script lang="ts">
  /**
   * Свои устройства в модалке (`user.sessions`). Данные — тот же `load`,
   * что у `/user/sessions`. Пока их нет, оболочку не рисуем: скелетон ядра
   * остаётся на время загрузки, пустой кадр не подменяем своим.
   */
  import { useLoader } from '#lib/modals/svelte/index.js'
  import { Surface } from '#components/ui/index.js'
  import type { SessionsRouteData } from '../types.js'
  import Acl from './Acl.svelte'
  import SessionsView from './SessionsView.svelte'

  const ldr = useLoader<SessionsRouteData>()
</script>

<Surface variant="plain" scroll={false} class="flex min-h-0 flex-1 flex-col w-full p-6">
  {#if ldr.data?.enabled === false || ldr.data?.fact}
    <Acl status={ldr.data?.fact} enabled={ldr.data?.enabled} backHref="/" variant="plain" />
  {:else if ldr.data?.page}
    <SessionsView page={ldr.data.page} notice={ldr.data.notice} variant="plain" class="min-h-0 flex-1" />
  {/if}
</Surface>
