// Поиск по пагинатору — ЛОГИКА без разметки (решение владельца, ход 117:
// логика отдельно, разметка — у страницы). Поле и кнопки рисует страница,
// хук отдаёт им значение, обработчики и флаги.
//
// Поле запроса — обычное поле lib/form (предписание `paginate/svelte/search`:
// «поле запроса — обычное поле lib form, транспорт — GET-форма, а commit —
// setSearchQuery»). Форма объявлена (`field.search`), транспорт — url-канал
// `bind`: до оживления нативный GET (жив и без JS), после — коммит в стор
// пагинатора тем же `setExtra`, а адрес правит транспорт хранилища. Имя поля,
// перенос остального адреса и ссылку «Сбросить» даёт адаптер пагинатора
// (`fieldName('q')`, `carryFields`, `linkFor`): формат хранилища хук не знает.
//
// Хук — в `lib/components/paginator`, а не в `paginate/search`: он склеивает lib/form,
// роутер, lib/paginate и paginate/search; положить его в одну из них — привязать
// независимую библиотеку к трём другим.
import { onMount, untrack } from 'svelte'
import { defineForm, field, v } from '#lib/form/index.js'
import { bind, createConfig, type BoundForm, type FieldView } from '#lib/form/svelte/index.js'
import { currentPathname, currentSearch } from '#lib/paginate/sveltekit/router.js'
import { getClientStore, getPaginator, linkFor, setExtra } from '#lib/paginate/index.js'
import { normalizeSearchQuery } from '#lib/paginate/search/index.js'
import type { TaskState } from '#lib/task/index.js'
import { useActionTask } from './action-task.svelte.js'

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
  /** Запрос выключен (источник не умеет искать, опция панели) — JS-путь не применяет ввод. */
  disabled?: () => boolean
  /** Почему выключен: причина видна там же, где пытаются вводить. */
  reason?: () => string | undefined
}

export interface PaginatorSearch {
  /** Форма для `<Form {form}>`: GET до оживления, коммит в стор после. */
  readonly form: BoundForm
  /** Вид поля запроса: `attrs` (имя, `type="search"`, `maxlength`), подпись, ошибки. */
  readonly field: FieldView
  /** Что показать в поле: набранное, иначе запрос стора (с JS) или адреса (без JS). */
  readonly value: string
  readonly disabled: boolean
  readonly reason: string | undefined
  /**
   * Страница ожила. До этого (и без JS) разметка показывает «Найти» и ссылку
   * «Сбросить»; после — только поле с крестиком (ход 116).
   */
  readonly hydrated: boolean
  /** В адресе есть запрос — есть что сбрасывать ссылкой до оживления. */
  readonly hasQuery: boolean
  /** Первая страница без запроса — ссылка «Сбросить» без JS; `null` — у транспорта ссылок нет. */
  readonly resetHref: string | null
  /** Остальное состояние адреса — скрытыми полями формы: GET-отправка его не сотрёт. */
  readonly hiddenFields: readonly { name: string; value: string }[]
  /** Обработчик ввода поля: живая проверка сразу, применение — с задержкой. */
  input(event: Event): void
  /** Обработчик отправки формы: до оживления — нативный GET, после — сразу в стор. */
  submit(event: SubmitEvent): void
  /** Очистить запрос (крестик поля). */
  clear(): void
  /** Идёт выдача, запрошенная ЭТИМ полем (`#lib/task`): спиннер в поле, глобальный лоадер. */
  readonly task: TaskState
}

/**
 * Поиск по пагинатору `name`. Вызывать при инициализации компонента: хук
 * регистрирует `onMount` и эффект.
 *
 * ```svelte
 * <script>
 *   const search = usePaginatorSearch(name, { label: 'Поиск', query: () => query })
 * </script>
 * <Form form={search.form} hiddenFields={search.hiddenFields} onsubmit={search.submit}>
 *   <SearchInput {...search.field.attrs} value={search.value} oninput={search.input} onClear={search.clear} />
 *   {#if !search.hydrated}<button type="submit">Найти</button>{/if}
 * </Form>
 * ```
 */
export function usePaginatorSearch(name: string, o: PaginatorSearchOptions): PaginatorSearch {
  const { maxLength = 120, debounce = 300 } = o
  const adapter = getPaginator(name).adapter
  // Имя поля во внешнем хранилище (URL: `page.q`) — решение транспорта.
  const path = adapter.fieldName?.('q') ?? 'q'
  const isDisabled = () => o.disabled?.() ?? false

  // Настройка одна на поиск: компонент поля пишет страница, транспорт url-режиму
  // не нужен — POST-путь не задействуется.
  const config = createConfig({ resolve: () => undefined, live: 'on-input' })

  // Объявление не реактивное: имя пагинатора, ключ и предел фиксируются при
  // вызове (страница не переключает их на лету).
  const desc = defineForm({
    id: `search-${name}`,
    fields: {
      [path]: field.search({ label: o.label, placeholder: o.placeholder, validate: [v.maxLength(maxLength)] }),
    },
  })

  /** Последний запрос, отправленный ЭТИМ полем: его эхо из стора — не внешняя правка. */
  let committed: string | null = null
  // Новый запрос (не тот же самый) перезагружает выдачу — это задача поля.
  const action = useActionTask(name)
  const send = (q: string) => {
    if (q !== String(o.query() ?? '')) action.fire()
    committed = q
    void setExtra(getClientStore(), name, { q })
  }

  const form = bind(config, desc, {
    url: {
      // Нормализация — общая с lib search (та же, что у валидатора адреса).
      commit: (patch) => {
        send(normalizeSearchQuery(String(patch[path] ?? ''), maxLength))
      },
      // Зеркало bind получает значение из состояния (не из адреса).
      seed: () => ({ [path]: o.query() ?? '' }),
    },
  })
  const vf = $derived(form.field(path)!)

  // Гашение поля — работа JS: без JavaScript контрол остаётся живым, иначе
  // браузер не отправит его значение и запрос пропал бы молча.
  let hydrated = $state(false)
  onMount(() => {
    hydrated = true
  })

  /**
   * До оживления и без JS значение — из адреса (SSR/deep-link: форма рождается
   * с запросом). С JS — из СТОРА: хранилище может быть не адресным
   * (`local`/`none`), и поле обязано показывать то же, по чему строится выдача.
   * Набранное (`typed`) поверх — чтобы эхо коммита не переставляло курсор.
   */
  const fromAddress = $derived(String(currentSearch()[path] ?? '').slice(0, maxLength))
  let typed = $state<string | null>(null)
  const value = $derived(typed ?? (hydrated ? String(o.query() ?? '') : fromAddress))

  // Запрос сменился НЕ отправкой этого поля (смена источника снимает `q`, «назад»,
  // другой виджет) — набранное устарело: поле показывает стор. Эхо своей отправки
  // набранное не трогает — иначе дописанное за время запроса стёрлось бы.
  $effect.pre(() => {
    const q = String(o.query() ?? '')
    untrack(() => {
      if (q !== committed) typed = null
    })
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  const stopTimer = () => clearTimeout(timer)

  /** Свой запрос не переносится (его несёт поле), указатель страницы — тоже: новый запрос — с первой. */
  const preserved = $derived(adapter.carryFields?.(currentSearch(), ['q']) ?? [])

  /**
   * «Сбросить» без JS — ссылка, а не `type="reset"`: сброс формы вернул бы поле
   * к значению из разметки, т. е. к тому же запросу.
   */
  const resetHref = $derived.by(() => {
    const href = linkFor(name, { page: 1, patch: { q: undefined } }, { search: currentSearch() })
    return href === null ? null : `${currentPathname()}${href}`
  })

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
      return preserved
    },
    get task() {
      return action.task()
    },
    input(event) {
      const raw = (event.currentTarget as HTMLInputElement).value.slice(0, maxLength)
      typed = raw
      // Зеркало bind и живая проверка — штатным путём поля; в стор — с задержкой.
      vf.onInput(raw)
      stopTimer()
      if (isDisabled()) return
      timer = setTimeout(() => form.commit(), debounce)
    },
    submit(event) {
      if (!hydrated) return // нативный GET до оживления (и без JS)
      event.preventDefault()
      stopTimer()
      if (!isDisabled()) form.commit()
    },
    clear() {
      stopTimer()
      typed = ''
      vf.onInput('')
      send('')
    },
  }
}
