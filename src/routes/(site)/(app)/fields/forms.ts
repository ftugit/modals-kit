// Изоморфная часть страницы `/fields`: форма набора и форма записи. Её импортируют
// и страница, и сервер — расхождение «браузер проверяет одно, сервер другое» исключено.
//
// Набор полей — обычное поле формы (`field.fields`): каталог видов и пределы правил
// объявлены в нём. Сохранённый набор снова становится формой — `defineForm({ from })` —
// и расширяется полями из кода: название и изображение.
import { defineForm, field, v, type FieldSetItem, type FormDescription } from '#lib/form/index.js'

/** Сколько полей можно собрать: предел поля-родителя. */
export const MAX_FIELDS = 8

/** Поле набора: виды, правила на выбор и пределы аргументов. Подписи видов выбирает приложение. */
const props = (saved?: readonly FieldSetItem[]) => field.fields({
  label: 'Поля записи',
  help: `До ${MAX_FIELDS} полей. Поле без названия не сохраняется. Значение правила за пределом заменяется при сохранении.`,
  max: MAX_FIELDS,
  rules: {
    required: {},
    integer: {},
    minLength: { min: 0, max: 2000 },
    maxLength: { min: 1, max: 2000, default: 200 },
    minValue: { min: -1_000_000, max: 1_000_000 },
    maxValue: { min: -1_000_000, max: 1_000_000 },
  },
  kinds: {
    text: { label: 'Строка', input: 'text', extra: ['required', 'minLength', 'maxLength'] },
    textarea: { label: 'Текст', input: 'textarea', extra: ['required', 'minLength', 'maxLength'], rules: { maxLength: { default: 1000 } } },
    email: { label: 'Почта', input: 'email', locked: ['email'], extra: ['required', 'maxLength'], rules: { maxLength: { max: 254 } } },
    url: { label: 'Ссылка', input: 'url', locked: ['url'], extra: ['required', 'maxLength'], rules: { maxLength: { default: 2000 } } },
    tel: { label: 'Телефон', input: 'tel', locked: [{ rule: 'pattern', arg: 'e164' }], extra: ['required'] },
    number: { label: 'Число', input: 'number', extra: ['required', 'minValue', 'maxValue', 'integer'] },
  },
  // сохранённый набор — начальное значение места под поля
  ...(saved ? { defaultValue: saved } : {}),
})

/**
 * Форма набора. Имена записей не зависят от сохранённого: сервер проверяет той же
 * формой без `saved`, страница показывает сохранённое как начальное значение.
 */
export const collectionForm = (saved?: readonly FieldSetItem[]): FormDescription => defineForm({
  id: 'fields-builder',
  revision: 1,
  actions: [{ id: 'submit', label: 'Сохранить', validate: 'full' }],
  fields: { props: props(saved) },
})

/** Сохранённый набор: то, что лежит в кэше. */
export interface SavedSet {
  readonly version: number
  /** Значение поля набора после приведения — самодостаточная схема полей. */
  readonly fields: readonly FieldSetItem[]
}

/* ── форма записи ─────────────────────────────────────────────────── */

/** Типы изображений, которые принимает запись. Сервер сверяет и содержимое. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export const IMAGE_MAX_BYTES = 1024 * 1024

/**
 * Форма записи: поля сохранённого набора (имена `u_…`), затем название и изображение.
 * Её же поднимает сервер — описание из сохранённого, а не из тела запроса.
 */
export const recordForm = (set: SavedSet | null): FormDescription => defineForm({
  id: 'fields-record',
  revision: set?.version ?? 1,
  actions: [{ id: 'submit', label: 'Отправить', validate: 'full' }],
  from: set?.fields ?? [],
  fields: {
    title: field.text({ label: 'Название', validate: [v.required(), v.maxLength(120)] }),
    image: field.file({
      label: 'Изображение',
      help: 'PNG, JPEG, WebP или GIF, до 1 МБ',
      validate: [v.required(), v.accept([...IMAGE_TYPES]), v.maxSize(IMAGE_MAX_BYTES)],
    }),
  },
})

/** Пример записи: то, что показывается после отправки. */
export interface SavedRecord {
  /** Номер отправки: новая запись — новая форма (пересборка по ключу). */
  readonly n: number
  readonly title: string
  /** `data:image/…;base64,…` — тип по содержимому файла, а не по заявке браузера. */
  readonly image: string
  readonly entries: readonly { readonly label: string; readonly value: string }[]
}
