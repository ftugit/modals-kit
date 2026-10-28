import type { BoundConfig, BoundForm } from '#lib/form/svelte/index.js'
import type { FormDescription, IssueLike } from '#lib/form/index.js'

/** Публичная безопасная витрина одной записи куки-сейфа (без секретов — безопасно для SSR и HTML). */
export interface CookieVaultMaskedItem<TMeta = Record<string, unknown>> {
  /** Идентификатор слота (`[a-z0-9_-]+`, часть имени куки `dv_<scope>_<id>`). */
  readonly id: string
  /** Заголовок слота для карточки. */
  readonly label: string
  /** Замаскированная строка секрета/DSN (например `s3://***@host/bucket/prefix`). */
  readonly summary: string
  /** Несекретные поля конфига экземпляра (лимиты, флаги и т.д.). */
  readonly meta: TMeta
  /** ISO-время сохранения слота. */
  readonly updatedAt: string
}

/** Снимок состояния куки-сейфа одного `scope` для SSR `load` и модалки. */
export interface CookieVaultSnapshot<TMeta = Record<string, unknown>> {
  readonly scope: string
  readonly hasKey: boolean
  readonly maxEntries: number
  readonly items: readonly CookieVaultMaskedItem<TMeta>[]
}

/** Результат разбора формы сохранения слота на сервере. */
export type CookieVaultParsed<TEntry> =
  | { readonly ok: true; readonly id: string; readonly entry: TEntry }
  | { readonly ok: false; readonly issues: readonly IssueLike[] }

/** Спецификация экземпляра универсального куки-сейфа (по аналогии со схемой фильтров). */
export interface CookieVaultSpec<
  TEntry = Record<string, unknown>,
  TMeta = Record<string, unknown>,
> {
  /** Уникальное имя области кук (`[a-z][a-z0-9_]{0,19}`, куки `dv_<scope>_<id>`). */
  readonly scope: string
  /** Заголовок сейфа по умолчанию. */
  readonly title: string
  /** Пояснение назначения сейфа. */
  readonly description?: string
  /** Максимум слотов в этой области (по умолчанию `8`, чтобы не превышать лимит заголовка `Cookie`). */
  readonly maxEntries?: number
  /** Изоморфное описание формы добавления/обновления слота (`defineForm` экземпляра). */
  readonly entryForm: FormDescription
  /** Разбор и проверка значений формы на сервере в пару `{ id, entry }`. */
  parse(values: Readonly<Record<string, unknown>>): CookieVaultParsed<TEntry>
  /** Маскирование секретной записи в безопасную публичную карточку без секретов. */
  mask(
    id: string,
    entry: TEntry,
    updatedAt: string,
  ): Omit<CookieVaultMaskedItem<TMeta>, 'id' | 'updatedAt'>
}

/** Готовая схема экземпляра куки-сейфа со служебными описаниями форм удаления и сброса ключа. */
export interface CookieVaultSchema<
  TEntry = Record<string, unknown>,
  TMeta = Record<string, unknown>,
> extends CookieVaultSpec<TEntry, TMeta> {
  readonly maxEntries: number
  readonly deleteForm: FormDescription
  deleteFormFor(id: string): FormDescription
  readonly resetKeyForm: FormDescription
}

/** Пропсы пользовательского UI-компонента формы экземпляра куки-сейфа (по аналогии с `FilterFormProps`). */
export interface CookieVaultFormProps<TMeta = Record<string, unknown>> {
  /** Конфиг форм приложения (`forms` из `#components/form/forms.config.js`). */
  readonly config: BoundConfig
  /** Схема данного экземпляра куки-сейфа. */
  readonly schema: CookieVaultSchema<unknown, TMeta>
  /** Текущий список сохранённых слотов (маскированный). */
  readonly items: readonly CookieVaultMaskedItem<TMeta>[]
  /** Коллбэк после успешного сохранения слота на клиенте. */
  onSaved?(snapshot: CookieVaultSnapshot<TMeta>): void
}

/** Возвращаемая связка `bindCookieVault(() => props)` для раскладки полей в UI экземпляра. */
export interface BoundCookieVaultForm {
  readonly form: BoundForm
  readonly f: BoundForm['f']
  readonly common: BoundForm['common']
  readonly state: BoundForm['state']
  hidden(): ReturnType<BoundForm['hidden']>
}
