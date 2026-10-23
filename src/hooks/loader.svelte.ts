// Глобальный лоадер — одна полоска сверху страницы на ВСЕ задачи сайта.
//
// Источники сами себя не подключают к библиотекам: задачу сюда несёт UI.
//  - переход SvelteKit (`navigationTask`) — без процента, полоса «бежит»;
//  - каждая ссылка `asLink`/`asModalLink` и каждая `Button` с `task` —
//    через `reflectTask` (`links/state.svelte.ts`), руками звать не нужно;
//  - своё — `trackTask(() => task)` внутри эффекта или вложения.
//
// Задача `scope: 'global'` зажигает полосу сразу, `local` — если идёт дольше
// `TASK_DELAY_MS`: короткие переходы не мигают (задержку держит полоса).
import { untrack } from 'svelte'
import { navigationTask } from '#lib/address/sveltekit.js'
import { taskLabel, taskPercent, type TaskState } from '#lib/task/index.js'

type Read = () => TaskState

/**
 * Задержка показа local-задачи — у полосы и у спиннера на ссылке/кнопке:
 * то, что уложилось в неё, не мигает. «Мелкие» записи адреса (модалки,
 * пагинатор) держат `navigating` 1–2 мс (замер хода 129) и сюда не доходят.
 */
export const TASK_DELAY_MS = 150

// `raw`: функции не проксируются, сравнение по ссылке работает.
let sources = $state.raw<Read[]>([])

/**
 * Показать задачу в общей полосе, пока элемент или компонент жив. Возвращает
 * отписку — её удобно вернуть из `$effect` или вложения:
 *
 *     $effect(() => trackTask(() => upload.task))
 */
export function trackTask(read: Read): () => void {
  // `untrack`: вызов живёт в чужом эффекте — чтение списка не должно делать
  // его зависимостью (иначе каждая регистрация перезапускала бы все остальные).
  untrack(() => (sources = [...sources, read]))
  return () => untrack(() => (sources = sources.filter((r) => r !== read)))
}

export interface LoaderView {
  /** Идёт хотя бы одна задача. */
  readonly active: boolean
  /** Среди них есть `scope: 'global'` — показывать без задержки. */
  readonly global: boolean
  /** Честный процент первой задачи, у которой он известен; `null` — полоса без процента. */
  readonly percent: number | null
  /** Подпись этой задачи (`taskLabel`) — для `aria-label`. */
  readonly label?: string
}

/** Сводка всех идущих задач. Реактивна: читать в `$derived`. */
export function loaderView(): LoaderView {
  const pending = [navigationTask(), ...sources.map((read) => read())].filter((t) => t.status === 'pending')
  const measured = pending.find((t) => taskPercent(t) !== null)
  return {
    active: pending.length > 0,
    global: pending.some((t) => t.status === 'pending' && t.scope === 'global'),
    percent: taskPercent(measured),
    label: taskLabel(measured ?? pending[0]),
  }
}
