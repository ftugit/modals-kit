<script lang="ts">
  /**
   * Устройства в модалке (`user.sessions`): свои — без параметров, аккаунта —
   * с `id`. Данные — тот же `load`, что у страницы-фallback (`/user/sessions`
   * или `/user/[id]/sessions`); список — общий `SessionsList` с фильтрами.
   * Пока данных нет, оболочку не рисуем: скелетон ядра остаётся на время
   * загрузки, пустой кадр не подменяем своим.
   */
  import { useLoader, useModal } from '#lib/modals/svelte/index.js'
  import { Surface } from '#components/ui/index.js'
  import type { SessionsRouteData } from '../types.js'
  import Acl from './Acl.svelte'
  import SessionsList from './SessionsList.svelte'

  const modal = useModal<{ id?: string }>()
  const ldr = useLoader<SessionsRouteData>()
  // Цель списка — `id` модалки, а не только данные `load`: ответ мог задержаться,
  // а экшены и адреса порций собираются из пропа. Без `id` — свои устройства.
  const uid = $derived(modal.params?.id ?? ldr.data?.uid ?? null)
  // Данные `load` — только своей цели: чужой срез (ещё не сменённый `uid`) не
  // должен на один тик показать устройства другого аккаунта. Так же в
  // `BlocksModal`.
  const initial = $derived(
    ldr.data && (ldr.data.uid ?? null) === (uid ?? null) ? ldr.data : null,
  )
</script>

<Surface variant="plain" scroll={false} class="flex min-h-0 flex-1 flex-col w-full p-6">
  {#if ldr.data?.enabled === false || ldr.data?.fact}
    <Acl status={ldr.data?.fact} enabled={ldr.data?.enabled} backHref="/" variant="plain" />
  {:else if ldr.data}
    {#key uid}
      <SessionsList {uid} {initial} variant="plain" class="min-h-0 flex-1" />
    {/key}
  {/if}
</Surface>
