// Слой фреймворка: ЕДИНСТВЕННОЕ место, где ядро встречается с реактивностью.
//
// Ядро (`store.ts`) — обычный объект и множество слушателей. Здесь оно
// оборачивается в руну `$state`. Заменить Svelte на что-то другое =
// переписать этот файл, и только его.
//
// Фабрика, а не класс — как весь `lib/` исходного проекта.
import { getClientStore } from '../store'
import type { ModalStore, ModalStoreData } from '../store'

/**
 * Реактивное зеркало стора.
 *
 * Зеркало, а не источник: писать по-прежнему через действия ядра.
 * Односторонний поток сохраняется: транспорт → ядро → зеркало → разметка.
 */
export function createReactiveStore(core: ModalStore = getClientStore(), scoped = false) {
  // $state.raw: ядро отдаёт НОВЫЙ объект на каждое изменение, поэтому
  // глубокая проксификация не нужна — сравнение по ссылке точнее и дешевле.
  let snapshot = $state.raw<ModalStoreData>(core.state as ModalStoreData)

  const off = core.subscribe((next) => {
    snapshot = next
  })

  return {
    /** Ядро — для действий (открыть/закрыть/настроить). */
    core,

    get chain() {
      return snapshot.chain
    },
    get hostConfig() {
      // Ключ скоупа — данные стора (`scopeKey`), пишет его адаптер через
      // `setScope`. Здесь геттер ЧИСТЫЙ: подписка — только на снапшот,
      // никаких чтений `page` (иначе эффекты хоста подписываются на
      // навигацию и отрывают ядро посреди popstate — R-03).
      if (!scoped) return snapshot.hostConfig
      return { ...snapshot.hostConfig, ...snapshot.hostConfigBy[snapshot.scopeKey] }
    },
    get runtime() {
      return snapshot.runtime
    },
    get data() {
      return snapshot.data
    },
    get sharedData() {
      return snapshot.sharedData
    },
    get registryVersion() {
      return snapshot.registryVersion
    },

    /** Отписка. Хост зовёт на размонтировании. */
    destroy() {
      off()
    },
  }
}

export type ReactiveModalStore = ReturnType<typeof createReactiveStore>
