<script lang="ts">
  /**
   * Действия узла — только ссылки (`plan-drive-repair.md` §6.1).
   *
   * Набор и порядок задаёт доменный дескриптор `driveNodeActions`; компонент
   * только превращает его в ссылки и отдаёт `OverflowMenu`. При живом хосте
   * модалок ссылка открывает модалку, без JS остаётся fallback-страница.
   */
  import type { DriveCapabilities, DriveNodeView } from '#core/lib/drive/index.js'
  import { asLink, useModalLink } from '#core/hooks/links/index.js'
  import { tryUseModals } from '#core/lib/modals/svelte/index.js'
  import { OverflowMenu, type OverflowMenuItem } from '#core/ui/index.js'
  import { driveNodeActions, driveNodeActionsVisible } from '../actions.js'
  import { driveOperationHref, type DriveOperationName, type DriveOperationParams } from '../operations.js'
  import { driveAccessRoute } from '../routes.js'

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

  let { node, caps, returnTo, trashed = false, downloadHref = null }: Props = $props()

  // Без хоста модалок (SSR-тест, страница без ModalHost) ссылка остаётся
  // обычной: fallback route операции работает без JS.
  const asModalLink = tryUseModals() ? useModalLink() : null
  const link = (name: DriveOperationName, extra: DriveOperationParams = {}) => {
    const params = { nodeId: node.id, returnTo, ...extra }
    return asModalLink ? asModalLink(`drive.${name}`, params) : asLink(driveOperationHref(name, params))
  }

  const accessLink = () =>
    asModalLink
      ? asModalLink('drive.access', { nodeId: node.id, returnTo })
      : asLink(driveAccessRoute.href({ node_id: node.id }))

  // 2 действия на узком экране, 5 на широком; SSR по умолчанию широкий.
  let narrow = $state(false)
  $effect(() => {
    if (typeof window === 'undefined') return
    const query = window.matchMedia('(max-width: 639px)')
    narrow = query.matches
    const onChange = (event: MediaQueryListEvent) => (narrow = event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  })

  const items = $derived<OverflowMenuItem[]>(
    driveNodeActions(node, caps, { trashed, canDownload: Boolean(downloadHref) }).map((action) => {
      if (action.id === 'download') {
        return {
          id: action.id,
          label: action.label,
          href: downloadHref ?? undefined,
          primary: action.primary,
        }
      }
      const attrs = action.id === 'access' ? accessLink() : link(action.id)
      return {
        id: action.id,
        label: action.label,
        href: attrs.href ?? undefined,
        attrs,
        destructive: action.destructive,
        primary: action.primary,
      }
    }),
  )
</script>

<OverflowMenu
  {items}
  maxVisible={narrow ? driveNodeActionsVisible(375) : driveNodeActionsVisible(1024)}
  mode="count"
  moreLabel="Ещё действия"
  data-testid="drive-node-links"
/>
