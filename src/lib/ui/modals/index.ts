// UI-примитивы модалок: порт src/ui/modals оригинала (внешний вид — логика
// живёт в lib/modals). Классы .modal-btn/.modal-trigger/.modal-skeleton —
// из modals.css + CVA-варианты из variants.ts.
export { default as BackdropCloseIcon } from './BackdropCloseIcon.svelte'
export { default as ButtonIndicator } from './ButtonIndicator.svelte'
export { default as CloseAllButton } from './CloseAllButton.svelte'
export { default as ForceClose } from './ForceClose.svelte'
export { default as ModalError } from './ModalError.svelte'
export { default as Skeleton } from './Skeleton.svelte'
export * from './variants'
