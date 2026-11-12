<script lang="ts">
  /**
   * Рисунок строки устройства внутри списка. Секретов строки (`jti`, версия)
   * здесь нет: сервер их не отдаёт. Хеш подсети показывается коротким префиксом.
   *
   * Кнопок и форм внутри нет: строка — ссылка на карточку (её механику задаёт
   * носитель `rowAttrs`), а отзыв и переименование живут в карточке.
   */
  import { Badge, TimeAgo } from '#components/ui/index.js'
  import type { SessionDeviceView } from '../types.js'

  interface Props {
    item: SessionDeviceView
    /** Момент отрисовки: статус истечения пересчитывается без запроса. */
    now?: number
  }

  let { item, now = Date.now() }: Props = $props()

  const status = $derived(
    item.deletedAt != null ? 'Завершена' : item.expiresAt > 0 && item.expiresAt <= now ? 'Истекла' : 'Активна',
  )
  const prefix = $derived(item.subnetHash ? item.subnetHash.slice(0, 8) : '—')
</script>

<div class="flex flex-col gap-1 py-1">
  <div class="flex flex-wrap items-center gap-2">
    <span class="font-medium">{item.deviceName?.trim() || 'Без имени'}</span>
    {#if item.current}
      <Badge variant="secondary" size="sm">Это устройство</Badge>
    {/if}
    <Badge variant="outline" size="sm">{status}</Badge>
  </div>
  <p class="text-xs text-muted-foreground">
    {item.country || 'Страна неизвестна'}
    · сеть {prefix}
    {#if item.history.length > 0}
      · сеть менялась
    {/if}
    {#if item.lastSeenAt}
      · активность <TimeAgo value={item.lastSeenAt} />
    {:else}
      · активности ещё не было
    {/if}
  </p>
</div>
