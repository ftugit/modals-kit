<script lang="ts">
  /**
   * Действия узла — только ссылки (`plan-drive-repair.md` §6.1).
   *
   * Форм на странице списка нет: каждая кнопка ведёт на свой операционный
   * route, а при живом хосте модалок открывает его модалку. Без JS та же
   * ссылка остаётся рабочей fallback-страницей.
   */
  import type { DriveCapabilities, DriveNodeView } from '#core/lib/drive/index.js'
  import { asLink, useModalLink } from '#core/hooks/links/index.js'
  import { tryUseModals } from '#core/lib/modals/svelte/index.js'
  import { Button } from '#core/ui/index.js'
  import { driveOperationHref, type DriveOperationName, type DriveOperationParams } from '../operations.js'

  interface Props {
    node: DriveNodeView
    caps: DriveCapabilities
    /** Адрес списка/карточки, куда вернётся операция. */
    returnTo: string
    trashed?: boolean
    /** GET-ссылка на байты файла (скачивание — не форма). */
    downloadHref?: string | null
    /** Компактный вид строки списка. */
    compact?: boolean
  }

  let { node, caps, returnTo, trashed = false, downloadHref = null, compact = false }: Props = $props()

  // Без хоста модалок (SSR-тест, страница без ModalHost) ссылка остаётся
  // обычной: fallback route операции работает без JS.
  const asModalLink = tryUseModals() ? useModalLink() : null
  const size = 'sm'
  const link = (name: DriveOperationName, extra: DriveOperationParams = {}) => {
    const params = { nodeId: node.id, returnTo, ...extra }
    return asModalLink ? asModalLink(`drive.${name}`, params) : asLink(driveOperationHref(name, params))
  }
</script>

<div class="flex flex-wrap items-center gap-1" data-testid="drive-node-links">
  {#if trashed}
    <Button {...link('restore')} variant="outline" {size}>Восстановить</Button>
    <Button {...link('purge')} variant="ghost" {size} data-testid="drive-purge">Удалить навсегда</Button>
  {:else}
    {#if downloadHref}
      <Button href={downloadHref} variant="ghost" {size}>Скачать</Button>
    {/if}
    {#if caps.canWrite}
      <Button {...link('star')} variant="ghost" {size}>
        {node.starred ? 'Снять важное' : 'Важное'}
      </Button>
      <Button {...link('rename')} variant="ghost" {size}>Переименовать</Button>
      <Button {...link('move')} variant="ghost" {size}>Перенести</Button>
      <Button {...link('copy')} variant="ghost" {size}>Копия</Button>
      <Button {...link('trash-action')} variant="ghost" {size}>В корзину</Button>
    {/if}
    {#if caps.canShare}
      <Button {...link('share')} variant="ghost" {size}>Доступ</Button>
    {/if}
  {/if}
</div>
