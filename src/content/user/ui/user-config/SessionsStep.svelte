<script lang="ts">
  /**
   * Шаг «Сессии» внутри настроек пользователя: встроенный `SessionsList`
   * через `frame`-примитив `Listing` (один `Surface` — общий хост настроек).
   *
   * Не рисует свой `Surface`: шапка (controls, фильтры, счётчик) и тело
   * (пагинатор) отдаются родителю через `frame` и размещаются в его зонах.
   */
  import type { Snippet } from 'svelte'
  import SessionsList from '../SessionsList.svelte'
  import type { UserSurfaceVariant } from '../Acl.svelte'

  interface Props {
    /** Целевой uid (для чужого списка); пусто — свои сессии. */
    uid?: string | null
    /** Носитель: страница или модалка. */
    context?: 'page' | 'modal'
    /** Возвращает шапку/тело родителю (общий хост). */
    frame?: (parts: { header: Snippet; body: Snippet }) => unknown
    onAcl?: (fact: string) => void
    class?: string
  }

  let {
    uid = null,
    context = 'page',
    frame,
    onAcl,
    class: className,
  }: Props = $props()

  const target = $derived(
    uid ? { kind: 'account' as const, uid: uid as string } : { kind: 'own' as const },
  )
</script>

<SessionsList
  {target}
  mode={context === 'modal' ? 'modal' : 'page'}
  url={context !== 'modal'}
  initial={null}
  variant="plain"
  class={className}
  onAcl={onAcl ? (fact) => onAcl(fact) : undefined}
  frame={frame as never}
/>
