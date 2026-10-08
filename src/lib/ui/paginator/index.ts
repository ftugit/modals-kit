/**
 * src/lib/ui/paginator — готовые UI-компоненты поверх headless `lib/paginate`.
 */
// Виджеты панели живут в $lib/ui/settings (этап 8); реэкспорт — прежний API.
export { Field, Select, Toggle } from '$lib/ui/settings'
export { default as PaginatorSettings } from './PaginatorSettings.svelte'
export type { SettingsField, PanelEnabledBy } from './types'
export { compileDemoPanelSchema, type DemoPanelSchema, type DemoPanelInput, GATE_LABEL } from './compile'
export { default as PageList } from './PageList.svelte'
export { default as PageColumns } from './PageColumns.svelte'
export { default as PageDivider } from './PageDivider.svelte'
export { default as StatusRow } from './StatusRow.svelte'
export { default as Skeleton } from './Skeleton.svelte'
export { default as EmptyState } from './EmptyState.svelte'
export { default as ErrorRow } from './ErrorRow.svelte'
export { default as EndRow } from './EndRow.svelte'
export { default as ReplaceLoadingRow } from './ReplaceLoadingRow.svelte'
export { default as PageLink } from './PageLink.svelte'
export { default as PageNav, type PageNavRenderProps } from './PageNav.svelte'
export { default as ResetButton } from './ResetButton.svelte'
export { default as Spinner } from './Spinner.svelte'
export { default as LoadingIndicator } from './LoadingIndicator.svelte'
export { default as LoadMoreLink } from './LoadMoreLink.svelte'
export { default as EventLog, describeEvent } from './EventLog.svelte'
