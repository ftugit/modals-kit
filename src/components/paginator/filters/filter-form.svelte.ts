/**
 * `bindFilters` — форма фильтров одной схемы на механизме `#lib/form`.
 *
 * Компонент фильтров пишет приложение — свой под каждую схему, поля расставлены
 * руками, как в обычной форме. Описание полей (`shikimoriFilterForm` и т. п.)
 * собирает панель (`FiltersPanel`) и передаёт пропсами вместе с адресом и
 * колбэком применения; этот хук превращает их в `bind` формы с url-контуром:
 *
 *   • `live: false` — набор применяется целиком, только «Применить» (или явный
 *     `commit()`); без JS форма уходит обычным GET на страницу каталога;
 *   • значения сеются из применённого набора (`extra`) ОДИН раз — набор,
 *     изменённый вне формы, панель пересоздаёт ключом;
 *   • проверка — та же, что на сервере: правила описания (связки, диапазоны,
 *     «все из» ∩ «кроме») показываются под полями до похода на сервер;
 *   • связка гасит контрол только после оживления (см. `live`).
 *
 * ```svelte
 * <script lang="ts">
 *   let props: FilterFormProps = $props()
 *   const filters = bindFilters(() => props)
 * </script>
 * <Form form={filters.form} hiddenFields={props.hidden}>
 *   <Field of={filters.f['genres.and']} />
 *   <Field of={filters.f['year.min']} />
 *   <FilterActions resetHref={props.resetHref} />
 * </Form>
 * ```
 */
import { bind, createConfig, type FieldView } from '#lib/form/svelte/index.js'
import type { FormDescription } from '#lib/form/index.js'
import { FILTER_KEY_PREFIX } from '#lib/paginate/index.js'
import type { CatalogFilterSchema } from '#lib/paginate/filters/index.js'

/** Пропсы компонента фильтров одной схемы: их передаёт `FiltersPanel`. */
export interface FilterFormProps {
  /** Описание формы под схему (имена — с адресным слоем: `page.filters.kind`). */
  description: FormDescription
  /** Схема источника: варианты, обрезка списков. */
  schema: CatalogFilterSchema
  /** Применённый набор (`extra` пагинатора): канонические пути `filters.*`. */
  values: Record<string, unknown> | undefined
  /** Адресный слой имён: `page` → `page.filters.…`. */
  prefix: string
  /** `action` нативной формы: страница каталога (GET). */
  action?: string
  /** Поля, которые форма без JS обязана пронести (`carryFields` адаптера). */
  hidden: readonly { name: string; value: string }[]
  /** Ссылка «сбросить свои фильтры» от адаптера; нет — у хранилища ссылок нет. */
  resetHref?: string
  /** Сброс тем же каналом состояния: клик по ссылке с JS или кнопка без ссылки. */
  onReset?: () => void
  /** Выбор пользователя: путь поля → значения (пустые отброшены). */
  onApply?: (values: Record<string, string[]>) => void
}

/**
 * Идентификатор контрола — его адресное имя (`page.filters.kind`): `<label for>`
 * указывает на существующий узел, и id читается так же, как имя поля. Точки в
 * id допустимы (HTML5 запрещает только пробелы).
 */
const filterForms = createConfig({
  resolve: () => undefined,
  ui: { fieldId: (_formId, name) => name },
})

/**
 * Пропсы приходят геттером: `action` и колбэк живые (меняются после записи
 * истории), а описание, значения и слой читаются один раз — смену набора
 * или схемы панель делает пересозданием компонента.
 */
export function bindFilters(read: () => FilterFormProps) {
  const props = read()
  const layer = props.prefix ? `${props.prefix}.` : ''
  const form = bind(filterForms, props.description, {
    url: {
      live: false,
      // Геттер: `action` несёт чужие ключи адреса и меняется после «мелкой»
      // записи истории — связка читает его на каждом рендере.
      get action() {
        return read().action
      },
      // Список в `extra` и в адресе — строка через запятую (повторы нативного
      // GET адресный слой складывает в неё же); поле мультивыбора ждёт массив.
      seed: (d) => {
        const out: Record<string, unknown> = {}
        for (const f of d.fields) {
          const current = props.values?.[f.name.slice(layer.length)]
          if (current === undefined) continue
          out[f.name] =
            f.input === 'multiselect' && typeof current === 'string'
              ? current.split(',').map((item) => item.trim()).filter((item) => item !== '')
              : current
        }
        return out
      },
      commit: (patch) => {
        const onApply = read().onApply
        if (!onApply) return
        const next: Record<string, string[]> = {}
        for (const [name, raw] of Object.entries(patch)) {
          const list = (Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw])
            .map((item) => String(item).trim())
            .filter((item) => item !== '')
          if (list.length) next[name.slice(layer.length)] = list
        }
        onApply(next)
      },
    },
  })

  /**
   * Поля по ключам описания: `filters.f['genres.and']`, `filters.f.status`.
   * Поля, которого у источника нет (студии у GraphQL), нет и здесь — `Field`
   * с пустым `of` ничего не рисует.
   */
  const f = new Proxy({} as Record<string, FieldView | undefined>, {
    get: (_target, key) => (typeof key === 'string' ? live(form.field(`${layer}${FILTER_KEY_PREFIX}${key}`)) : undefined),
  })

  /**
   * Связка гасит контрол только с JavaScript. Без него выключенный контрол
   * браузер не отправил бы, и значение из адреса молча пропало бы из запроса;
   * причина под полем видна и до оживления (`reason`), а отказ набора
   * объясняет сервер. `submitVisible` формы — «ещё не оживлена».
   */
  const live = (view: FieldView | undefined): FieldView | undefined => {
    if (!view || !form.submitVisible || !view.attrs['disabled']) return view
    const { disabled: _disabled, ...attrs } = view.attrs
    return { ...view, attrs }
  }

  /**
   * Сколько вариантов ключа источник не прислал (аварийная обрезка схемы,
   * `optionsTruncated`): для пояснения рядом с полем. Текст — приложения.
   */
  const truncated = (key: string): number => read().schema.fields.find((field) => field.key === key)?.optionsTruncated ?? 0

  return { form, f, truncated }
}

export type BoundFilters = ReturnType<typeof bindFilters>
