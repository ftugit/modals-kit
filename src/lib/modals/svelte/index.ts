// Слой Svelte: реактивность и разметка. Единственное место, знающее
// о фреймворке (не считая ядра среды `cores/sveltekit.ts`).
export { default as ModalHost } from './ModalHost.svelte'
export { default as Layers } from './Layers.svelte'
export { default as Tails } from './Tails.svelte'
export { default as ModalContent } from './ModalContent.svelte'
export { default as ModalTrigger } from './ModalTrigger.svelte'

export {
  useChain, useModalDepth, useModalsOpen, useChainLocked, useHostConfig,
  useModal, useModalState, useModalData, useSharedData, useLoader,
} from './state.svelte'
export type { ModalHandle, ModalStateHandle } from './state.svelte'

export { createReactiveStore } from './store.svelte'
export type { ReactiveModalStore } from './store.svelte'
export { createMediaQuery, createIsNarrow } from './media.svelte'
export {
  setModalsContext, useModals, tryUseModals,
  setOverlayContainer, useOverlayContainer,
  setInstance, useInstance,
} from './context'
export type {
  ModalsContext, OverlayContainer, InstanceValue,
  HostFloatingApi, HostFloatingOptions, HostFloatingRect,
  HostFloatingCloseReason, HostFloatingPlacementOptions,
} from './context'
