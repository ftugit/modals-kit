// Поиск по пагинатору — логика без разметки.
//
// Поле — обычное поле lib/form (`q`). С JS ввод пишется в стор (`setExtra`),
// адрес правит транспорт хранилища. Без JS форма уходит POST на текущую
// страницу; сервер собирает адрес адаптером и отвечает 303. Нативного GET нет:
// формат адреса знает хранилище, не форма.
import { onMount, untrack } from 'svelte'
import { bindComponentForm } from '#hooks/component-form/index.js'
import { forms } from '#components/form/forms.config.js'
import { currentPathname, currentSearch } from '#lib/paginate/sveltekit/router.js'
import { linkFor, setExtra, transportOf } from '#lib/paginate/index.js'
import { useScopeStore } from '#lib/paginate/svelte/index.js'
import { normalizeSearchQuery } from '#lib/paginate/search/index.js'
import type { TaskState } from '#lib/task/index.js'
import type { BoundForm, FieldView } from '#lib/form/svelte/index.js'
import { useActionTask } from './action-task.svelte.js'
import { PAGINATOR_SEARCH_MAX, paginatorSearchForm } from './search-form.js'

export interface PaginatorSearchOptions {
  /** Подпись поля — текст страницы; своих текстов у хука нет. */
  label: string
  placeholder?: string
  /** Предел длины запроса; та же нормализация, что у валидатора адреса. По умолчанию 120. */
  maxLength?: number
  /** Задержка живого применения, мс. По умолчанию 300. */
  debounce?: number
  /**
   * Текущий запрос из СОСТОЯНИЯ пагинатора (не из адреса): выдача строится по
   * нему — поле обязано показывать то же. До оживления не используется.
   */
  query: () => string | undefined
  /** Адрес списка (путь и search), куда без JS вернёт 303. */
  from: () => string
  /** Базовый ключ адреса пагинатора (`users`, `blocks`). */
  pageParam: string
  /** Запрос выключен (источник не умеет искать, опция панели) — JS-путь не применяет ввод. */
  disabled?: () => boolean
  /** Почему выключен: причина видна там же, где пытаются вводить. */
  reason?: () => string | undefined
}

export interface PaginatorSearch {
  /** Форма для `<Form {form}>`: POST без JS, коммит в стор после оживления. */
  readonly form: BoundForm
  /** Вид поля запроса: `attrs` (имя `q`, `type="search"`, `maxlength`), подпись, ошибки. */
  readonly field: FieldView
  /** Что показать в поле: набранное, иначе запрос стора (с JS) или адреса (без JS). */
  readonly value: string
  readonly disabled: boolean
  readonly reason: string | undefined
  /**
   * Страница ожила. До этого (и без JS) разметка показывает «Найти» и ссылку
   * «Сбросить»; после — только поле с крестиком.
   */
  readonly hydrated: boolean
  /** В адресе есть запрос — есть что сбрасывать ссылкой до оживления. */
  readonly hasQuery: boolean
  /** Первая страница без запроса — ссылка «Сбросить» без JS; `null` — у транспорта ссылок нет. */
  readonly resetHref: string | null
  /** Конверт и скрытые поля носителя: POST без JS знает, какой список и куда вернуться. */
  readonly hiddenFields: readonly { name: string; value: string }[]
  /** Обработчик ввода поля: живая проверка сразу, применение — с задержкой. */
  input(event: Event): void
  /** Обработчик отправки формы: до оживления — нативный POST, после — сразу в стор. */
  submit(event: SubmitEvent): void
  /** Очистить запрос (крестик поля). */
  clear(): void
  /** Идёт выдача, запрошенная ЭТИМ полем (`#lib/task`): спиннер в поле, глобальный лоадер. */
  readonly task: TaskState
}

/**
 * Поиск по пагинатору `name`. Вызывать при инициализации компонента: хук
 * регистрирует `onMount` и эффект.
 */
export function usePaginatorSearch(name: string, o: PaginatorSearchOptions): PaginatorSearch {
  const { maxLength = PAGINATOR_SEARCH_MAX, debounce = 300 } = o
  const store = useScopeStore()
  const adapter = transportOf(store, name)
  const hasUrl = typeof adapter.observeExternal === 'function'
  // Имя во внешнем хранилище (URL: `users.q`) — только чтобы показать текущий
  // запрос и собрать ссылку сброса. Поле формы называется `q`.
  const addressKey = adapter.fieldName?.('q') ?? 'q'
  const isDisabled = () => o.disabled?.() ?? false

  const form = bindComponentForm(forms, paginatorSearchForm)
  const vf = $derived(form.field('q')!)

  let hydrated = $state(false)
  onMount(() => {
    hydrated = true
  })

  /** Последний запрос, отправленный ЭТИМ полем: его эхо из стора — не внешняя правка. */
  let committed: string | null = null
  const action = useActionTask(name)
  const send = (raw: string) => {
    const q = normalizeSearchQuery(raw, maxLength)
    if (q !== String(o.query() ?? '')) action.fire()
    committed = q
    void setExtra(store, name, { q })
  }

  const fromAddress = $derived(
    hasUrl ? String(currentSearch()[addressKey] ?? '').slice(0, maxLength) : '',
  )
  let typed = $state<string | null>(null)
  const value = $derived(typed ?? (hydrated ? String(o.query() ?? '') : fromAddress))

  $effect.pre(() => {
    const q = String(o.query() ?? '')
    untrack(() => {
      if (q !== committed) typed = null
    })
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  const stopTimer = () => clearTimeout(timer)

  const resetHref = $derived.by(() => {
    if (!hasUrl) return null
    const href = linkFor(name, { page: 1, patch: { q: undefined } }, { store, search: currentSearch() })
    return href === null ? null : `${currentPathname()}${href}`
  })

  const hiddenFields = $derived([
    ...form.hidden(),
    { name: 'paginator', value: name },
    { name: 'page_param', value: o.pageParam },
    { name: 'from', value: o.from() },
  ])

  return {
    form,
    get field() {
      return vf
    },
    get value() {
      return value
    },
    get disabled() {
      return isDisabled()
    },
    get reason() {
      return o.reason?.()
    },
    get hydrated() {
      return hydrated
    },
    get hasQuery() {
      return fromAddress !== ''
    },
    get resetHref() {
      return resetHref
    },
    get hiddenFields() {
      return hiddenFields
    },
    get task() {
      return action.task()
    },
    input(event) {
      const raw = (event.currentTarget as HTMLInputElement).value.slice(0, maxLength)
      typed = raw
      vf.onInput(raw)
      stopTimer()
      if (isDisabled()) return
      timer = setTimeout(() => send(typed ?? ''), debounce)
    },
    submit(event) {
      if (!hydrated) return
      event.preventDefault()
      stopTimer()
      if (!isDisabled()) send(typed ?? value)
    },
    clear() {
      stopTimer()
      typed = ''
      vf.onInput('')
      send('')
    },
  }
}
