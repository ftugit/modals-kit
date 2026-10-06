// Svelte 5 adapter entrypoint
export { default as PaginatorHost } from './PaginatorHost.svelte'
export { default as PageAnchor } from './PageAnchor.svelte'
export { default as EdgeSentinel } from './EdgeSentinel.svelte'
export { default as LoadMoreSlot, type LoadMoreSlotRender } from './LoadMoreSlot.svelte'
export { default as PendingIndicator, type PendingIndicatorRender } from './PendingIndicator.svelte'
export { default as PaginatorScope } from './PaginatorScope.svelte'

export {
  DEFAULT_HOST_OPTIONS,
  hashAnchorFor,
  useCtx,
  usePageHref,
  usePaginator,
  usePaginatorActions,
  usePaginatorEvents,
  usePaginatorItems,
  usePaginatorOptions,
  usePaginatorPages,
  usePaginatorState,
  usePaginatorViewState,
  useScopeStore,
  type EdgeTrigger,
  type PaginatorActions,
  type PaginatorContextValue,
  type PrependBehavior,
  type ResolvedHostOptions,
  type StateAccessor,
} from './context.svelte'
