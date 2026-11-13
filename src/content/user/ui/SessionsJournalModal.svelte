<script lang="ts">
  /**
   * Журнал сессий в модалке (`user.sessions.journal`): те же данные, что у
   * страницы `/sessions`, — тот же `load` и тот же `SessionsList` с флагом
   * `journal`. Цель не нужна: журнал показывает все сессии, которые зритель
   * вправе читать, поэтому ни `uid`, ни `{#key}` здесь нет.
   *
   * Пока данных нет, оболочку не рисуем: скелетон ядра остаётся на время
   * загрузки, пустой кадр не подменяем своим.
   */
  import { useLoader } from '#lib/modals/svelte/index.js'
  import { Surface } from '#components/ui/index.js'
  import type { SessionsRouteData } from '../types.js'
  import Acl from './Acl.svelte'
  import SessionsList from './SessionsList.svelte'

  const ldr = useLoader<SessionsRouteData>()
</script>

<Surface variant="plain" scroll={false} class="flex min-h-0 flex-1 flex-col w-full p-6">
  {#if ldr.data?.enabled === false || ldr.data?.fact}
    <Acl status={ldr.data?.fact} enabled={ldr.data?.enabled} backHref="/" variant="plain" />
  {:else if ldr.data}
    <SessionsList journal initial={ldr.data} mode="modal" variant="plain" class="min-h-0 flex-1" />
  {/if}
</Surface>
