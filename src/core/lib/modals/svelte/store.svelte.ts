// Слой фреймворка: ЕДИНСТВЕННОЕ место, где ядро встречается с реактивностью.
//
// Ядро (`store.ts`) — обычный объект и множество слушателей. Здесь оно
// оборачивается в руну `$state`. Заменить Svelte на что-то другое =
// переписать этот файл, и только его.
//
// Фабрика, а не класс — как весь `lib/` исходного проекта.
import { getClientStore } from '../store'
import type { ModalStore } from '../store'

/**
 * Реактивное зеркало стора.
 *
 * Зеркало, а не источник: писать по-прежнему через действия ядра.
 * Односторонний поток сохраняется: транспорт → ядро → зеркало → разметка.
 */
export function createReactiveStore(core: ModalStore = getClientStore(), scoped = false) {
  // Послойные `$state.raw`: обновление `runtime` (idle -> loading -> ready)
  // не трогает `chain` и `hostConfig` по ссылке и не будит эффекты стопки.
  let chain = $state.raw(core.state.chain)
  let configBase = core.state.hostConfig
  let configOverlay: (typeof core.state.hostConfigBy)[string] | undefined = scoped ? core.state.hostConfigBy[core.state.scopeKey] : undefined
  let mergedHostConfig = $state.raw(scoped ? { ...configBase, ...configOverlay } : configBase)
  let runtime = $state.raw(core.state.runtime)
  let data = $state.raw(core.state.data)
  let sharedData = $state.raw(core.state.sharedData)
  let registryVersion = $state(core.state.registryVersion)

  const off = core.subscribe((next) => {
    // Прямое присваивание компилируется в `set(signal, value)` без `get(signal)`:
    // Svelte 5 сам проверяет `Object.is(signal.v, value)` и НЕ подписывает
    // активный `$effect` (например `configureBase` / `setScope`), из которого
    // синхронно пришёл `core.set(...)`.
    chain = next.chain
    const overlay = scoped ? next.hostConfigBy[next.scopeKey] : undefined
    if (next.hostConfig !== configBase || overlay !== configOverlay) {
      configBase = next.hostConfig
      configOverlay = overlay
      mergedHostConfig = scoped ? { ...configBase, ...configOverlay } : configBase
    }
    runtime = next.runtime
    data = next.data
    sharedData = next.sharedData
    registryVersion = next.registryVersion
  })

  // Конфигурация обновляется в подписке только при смене базы или активного
  // слайса; посторонний runtime и слайсы других страниц сохраняют ссылку.

  return {
    /** Ядро — для действий (открыть/закрыть/настроить). */
    core,

    get chain() {
      return chain
    },
    get hostConfig() {
      return mergedHostConfig
    },
    get runtime() {
      return runtime
    },
    get data() {
      return data
    },
    get sharedData() {
      return sharedData
    },
    get registryVersion() {
      return registryVersion
    },

    /** Отписка. Хост зовёт на размонтировании. */
    destroy() {
      off()
    },
  }
}

export type ReactiveModalStore = ReturnType<typeof createReactiveStore>
