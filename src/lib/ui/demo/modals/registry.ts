import { createRegistry, globalScope } from '$lib/modals'
import CardModal from './CardModal.svelte'
import FullpageModal from './FullpageModal.svelte'
import LockedModal from './LockedModal.svelte'
import SelectModal from './SelectModal.svelte'
import FlowProbeModal from './FlowProbeModal.svelte'

const MODAL_DEFINITIONS = [
  {
    name: 'card',
    component: CardModal,
    size: { width: 520, height: 420 },
    color: 'var(--card)',
    tailColor: 'var(--border)',
    defaultParams: { slow: false },
    route: '/cards/$id',
    loader: async (params: Record<string, unknown>, signal: AbortSignal) => {
      const delay = params.slow ? 900 + Math.random() * 2100 : 220
      await new Promise((resolve) => setTimeout(resolve, delay))
      if (signal.aborted) throw new Error('отменено')
      return {
        title: `Карточка #${params.id ?? '—'}`,
        body: params.slow
          ? 'Данные пришли из загрузчика: пока он работал, был виден скелетон, а на кнопке крутился индикатор.'
          : 'Быстрый ответ загрузчика — скелетон почти не заметен.',
      }
    },
  },
  {
    name: 'flow-probe',
    component: FlowProbeModal,
    size: { width: 560, height: 320 },
    color: 'var(--card)',
    tailColor: 'var(--border)',
  },
  {
    name: 'fullpage',
    component: FullpageModal,
    size: 'fullpage',
    color: 'var(--card)',
    tailColor: 'var(--border)',
  },
  {
    name: 'broken-route',
    component: CardModal,
    size: { width: 420, height: 260 },
    color: 'var(--card)',
    tailColor: 'var(--border)',
    route: '/no-such-page/$id',
  },
  {
    name: 'locked',
    component: LockedModal,
    size: { width: 420, height: 260 },
    color: 'color-mix(in oklab, var(--warning) 10%, var(--card))',
    tailColor: 'color-mix(in oklab, var(--warning) 24%, var(--border))',
    lock: true,
  },
  {
    name: 'select',
    component: SelectModal,
    size: { width: 560, height: 360 },
    color: 'var(--card)',
    tailColor: 'var(--border)',
  },
] as any

/** Область роута: эти модалки существуют на /modals. */
export const demoScope = createRegistry('/modals', globalScope).define(MODAL_DEFINITIONS)
