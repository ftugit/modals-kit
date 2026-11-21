<script lang="ts">
  /**
   * Доступы узла «Диска» (`plan-drive-repair.md` §1.2, дополнительный экран).
   *
   * Один компонент на страницу `/drive/access` и модалку `drive.access`.
   * Список выданных доступов приходит из `load`; действия — только ссылки на
   * операции `drive.share` / `drive.unshare` (без inline-форм).
   */
  import type { DriveNodePageData, DriveShareView } from '../../types.js'
  import { asLink, useModalLink } from '#core/hooks/links/index.js'
  import { tryUseModals } from '#core/lib/modals/svelte/index.js'
  import { Button } from '#core/ui/index.js'
  import { driveOperationHref } from '../../operations.js'
  import { driveNodeRoute } from '../../routes.js'

  interface Props {
    data: DriveNodePageData
    /** Адрес носителя, куда вернутся операции. */
    returnTo: string
  }

  let { data, returnTo }: Props = $props()

  const asModalLink = tryUseModals() ? useModalLink() : null
  const nodeId = $derived(data.node?.id ?? '')
  const shareHref = $derived(
    asModalLink
      ? asModalLink('drive.share', { nodeId, returnTo })
      : asLink(driveOperationHref('share', { nodeId, returnTo })),
  )

  function unshareHref(share: DriveShareView) {
    const params = { nodeId, uid: share.uid, returnTo }
    return asModalLink
      ? asModalLink('drive.unshare', params)
      : asLink(driveOperationHref('unshare', params))
  }

  const roleLabel = (role: DriveShareView['role']) =>
    role === 'editor' ? 'Редактирование' : 'Просмотр'

  const created = (share: DriveShareView) =>
    new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short' }).format(share.createdAt)
</script>

<div class="flex min-w-0 flex-col gap-4" data-testid="drive-access">
  <div class="flex flex-wrap items-start justify-between gap-2">
    <div class="min-w-0">
      <h2 class="break-words text-base font-semibold leading-tight">
        Доступы{data.node ? `: ${data.node.name}` : ''}
      </h2>
      <p class="text-sm text-muted-foreground">
        Доступ наследуется всем поддеревом узла.
      </p>
    </div>
    <Button {...shareHref} size="sm">Выдать доступ</Button>
  </div>

  {#if data.shares.length === 0}
    <p class="rounded-lg border border-border p-3 text-sm text-muted-foreground">
      Пока никому не выдан доступ — видят только владелец и унаследованные роли.
    </p>
  {:else}
    <ul class="flex flex-col gap-2">
      {#each data.shares as share (share.id)}
        <li
          class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
          data-testid="drive-share-row"
        >
          <div class="flex min-w-0 flex-col">
            <span class="truncate text-sm" title={share.uid}>{share.label}</span>
            <span class="text-xs text-muted-foreground">
              {roleLabel(share.role)} · с {created(share)}
            </span>
          </div>
          <Button {...unshareHref(share)} variant="ghost" size="sm">Отозвать</Button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if data.node}
    <Button
      {...asLink(driveNodeRoute.href({ id: data.node.id }))}
      variant="outline"
      size="sm"
    >
      Открыть карточку
    </Button>
  {/if}
</div>
