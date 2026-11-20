<script lang="ts">
  /**
   * Шаг настроек «Пароли WebDAV». Полный экран — `/user/config/dav`: там
   * SSR-список, выдача и отзыв, поэтому шаг только ведёт туда и не загружает
   * данные вторым запросом.
   */
  import { Button } from '#core/ui/index.js'

  interface Props {
    uid?: string | null
    context?: 'page' | 'modal'
  }

  let { uid = null }: Props = $props()
</script>

<div class="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4" data-testid="drive-dav-step">
  <div class="flex min-w-0 flex-col gap-1">
    <span class="text-sm font-medium">Пароли приложений WebDAV</span>
    <span class="min-w-0 break-words text-xs text-muted-foreground">
      Выдача, список и отзыв паролей для подключения к диску по WebDAV.
    </span>
  </div>
  {#if !uid}
    <Button href="/user/config/dav" variant="outline" size="sm">Открыть</Button>
  {/if}
</div>
