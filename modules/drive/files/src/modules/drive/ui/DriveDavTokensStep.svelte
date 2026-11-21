<script lang="ts">
  /**
   * Шаг настроек «Пароли WebDAV». Полный экран — `/user/config/dav`: там
   * SSR-список, выдача и отзыв, поэтому шаг только ведёт туда и не загружает
   * данные вторым запросом. Разметка — общий `EntryCard`.
   */
  import { Button, EntryCard } from '#core/ui/index.js'

  interface Props {
    uid?: string | null
    context?: 'page' | 'modal'
  }

  let { uid = null }: Props = $props()
</script>

<EntryCard
  title="Пароли приложений WebDAV"
  description="Выдача, список и отзыв паролей для подключения к диску по WebDAV."
  data-testid="drive-dav-step"
>
  {#snippet actions()}
    {#if !uid}
      <Button href="/user/config/dav" variant="outline" size="sm">Открыть</Button>
    {/if}
  {/snippet}
</EntryCard>
