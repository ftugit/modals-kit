// Логика мобильного drawer'а поверх checkbox + CSS:
// Esc закрывает, клик по фону закрывает, Back закрывает без навигации.
//
// «Back закрывает» — флаг в `page.state` (shallow routing SvelteKit) через слой
// роутера, а не нативный `history.pushState` (баг F6, docs/audit/crutches.md).
import { onMount } from 'svelte'
import { goAddress, shallowFlag, visibleAddress } from '#lib/address/sveltekit.js'

export interface DrawerOptions {
  input: () => HTMLInputElement | undefined
  isNarrow: () => boolean
}

const HISTORY_FLAG = 'ddSidebar'

export function createDrawer(options: DrawerOptions) {
  let open = $state(false)
  const entry = shallowFlag(HISTORY_FLAG)

  const sync = () => {
    open = Boolean(options.input()?.checked)
  }

  const close = () => {
    const input = options.input()
    if (!input || !input.checked) return
    input.checked = false
    open = false
    // Своя запись истории есть — снимаем её: «Назад» после закрытия не должен
    // повторно «закрывать» уже закрытую панель. Смотрим на НАМЕРЕНИЕ писателя, а
    // не на применённый `page.state`: запись панели может ещё ждать в очереди
    // (за записью пагинатора), и тогда она применится уже после закрытия. Шаг
    // назад — через писателя (`goAddress`): он уйдёт после этой записи, а не
    // раньше неё, как прямой `history.back()` (F41, находка хода 40).
    if (visibleAddress().state[HISTORY_FLAG]) goAddress(-1)
  }

  // Back по записи панели: SvelteKit возвращает прежний `page.state` без флага.
  // Реагируем только на ПЕРЕХОД «был флаг → нет флага»: панель, открытая до
  // гидратации (без JS записи нет), так не закрывается сама.
  let hadEntry = false
  $effect(() => {
    const on = entry.on
    if (hadEntry && !on) {
      const input = options.input()
      if (input?.checked) {
        input.checked = false
        open = false
      }
    }
    hadEntry = on
  })

  onMount(() => {
    const input = options.input()
    if (!input) return
    sync()

    const onChange = () => {
      sync()
      if (input.checked) entry.push()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open && options.isNarrow()) {
        e.preventDefault()
        close()
      }
    }

    input.addEventListener('change', onChange)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      input.removeEventListener('change', onChange)
      window.removeEventListener('keydown', onKeyDown)
    }
  })

  return {
    get isOpen() {
      return open
    },
    close,
  }
}

export function labelKeyHandler(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).click()
  }
}
