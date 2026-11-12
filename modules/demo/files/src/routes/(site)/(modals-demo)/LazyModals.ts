// Группа загружается при первом открытии одной из демо-модалок, не при загрузке страницы.
// Один отложенный чанк избегает избыточного gzip-overhead пяти микрочанков.
export { default as CardModal } from './CardModal.svelte'
export { default as FullpageModal } from './FullpageModal.svelte'
export { default as LockedModal } from './LockedModal.svelte'
export { default as SelectModal } from './SelectModal.svelte'
export { default as FlowProbeModal } from './FlowProbeModal.svelte'
