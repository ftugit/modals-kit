/**
 * Каталог ключей конфига, которые читает код, — единая точка текстов, групп,
 * полей формы и бутстрап-умолчаний. Схемы прав ключей каталог НЕ задаёт: они
 * хранятся в самой конфиг-модели (строка умолчания, поле `schema`) и меняются
 * через конфиг-API (`config-api.ts`). Здесь — только то, что нужно коду
 * потребителя: человеческий текст для экранов, представление поля и значение,
 * действующее, пока в БД нет ни строки умолчания, ни переопределения юзера
 * (отсутствие строк конфига приложение не ломает).
 */
import { field } from '#lib/form/index.js'
import { specProfile } from './spec-profile.js'
import type { VisibilityLevel } from './types.js'

/** Группы настроек пользователя (переключаются через `#components/steps` при >= 2 непустых группах). */
export const CONFIG_GROUPS = {
  profile: {
    title: 'Профиль',
    description: 'Публичная видимость карточки профиля по прямой ссылке.',
  },
  security: {
    title: 'Безопасность',
    description: 'Правила защиты сеансов и входа.',
  },
} as const

export type ConfigGroupKey = keyof typeof CONFIG_GROUPS

export const CONFIG_GROUP_ORDER: readonly ConfigGroupKey[] = ['profile', 'security']

/** Общие подписи экрана настроек пользователя (`UserConfig`). */
export const specConfig = {
  ownTitle: 'Настройки',
  foreignTitle: 'Настройки пользователя',
  emptyTitle: 'Нет доступных параметров',
  emptyText: 'Для этого аккаунта нет параметров, открытых для чтения или редактирования.',
  readOnlyBadge: 'Только чтение',
  overriddenBadge: 'Переопределено',
  adminSetBadge: 'Задано администратором',
  defaultBadge: 'По умолчанию',
  resetButton: 'Сбросить к умолчанию',
  saveButton: 'Сохранить',
  cancelButton: 'Закрыть',
} as const

type AnyFieldDraft = ReturnType<typeof field.text> | ReturnType<typeof field.select> | ReturnType<typeof field.checkbox>

/** Как ключ показывать человеку, валидировать и превращать в поле формы. */
export interface ConfigKeyInfo {
  readonly fieldName: string
  readonly group: ConfigGroupKey
  readonly kind: 'select' | 'checkbox'
  readonly title: string
  readonly description: string
  /** Бутстрап-умолчание кода; нет поля — у ключа умолчания в коде нет. */
  readonly bootstrap?: unknown
  readonly options?: readonly { readonly value: string; readonly label: string }[]
  readonly toField: (defaultValue: unknown) => AnyFieldDraft
  readonly decodeValue: (
    raw: unknown,
  ) => { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly code: 'config.value-invalid' }
  readonly formatValue: (value: unknown) => string
}

const VISIBILITY_OPTIONS: readonly { readonly value: VisibilityLevel; readonly label: string }[] = (
  ['all', 'users', 'nobody'] as const
).map((value) => ({
  value,
  label: specProfile.privacyLevels[value],
}))

function isVisibilityLevel(v: unknown): v is VisibilityLevel {
  return v === 'all' || v === 'users' || v === 'nobody'
}

/** Ключи, которые читает код. Ключ вне каталога — только данные (раздел управления, свой потребитель). */
export const VISIBILITY_KEY = 'profile.visibility'

export const CONFIG_KEYS = {
  'profile.visibility': {
    fieldName: 'profile_visibility',
    group: 'profile',
    kind: 'select',
    title: 'Кто видит профиль',
    description: 'all — все, включая гостей; users — только вошедшие; nobody — владелец и держатели прав.',
    bootstrap: 'nobody',
    options: VISIBILITY_OPTIONS,
    toField: (defaultValue) =>
      field.select({
        label: 'Кто видит профиль',
        help: 'Публичная видимость карточки профиля по прямой ссылке.',
        defaultValue: isVisibilityLevel(defaultValue) ? defaultValue : 'nobody',
        options: VISIBILITY_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
      }),
    decodeValue: (raw) =>
      isVisibilityLevel(raw) ? { ok: true, value: raw } : { ok: false, code: 'config.value-invalid' },
    formatValue: (value) =>
      isVisibilityLevel(value) ? specProfile.privacyLevels[value] : String(value ?? ''),
  },
  'session.ipLock': {
    fieldName: 'session_ip_lock',
    group: 'security',
    kind: 'checkbox',
    title: 'Автовыход при смене IP',
    description: 'Сессия завершается, если адрес сменился. Закрепляется администратором, владельцу — только чтение.',
    bootstrap: false,
    toField: (defaultValue) =>
      field.checkbox({
        label: 'Автовыход при смене IP',
        help: 'Сессия завершается, если IP-адрес устройства изменился.',
        defaultValue: Boolean(defaultValue),
      }),
    decodeValue: (raw) => {
      if (typeof raw === 'boolean') return { ok: true, value: raw }
      if (raw === 'true' || raw === 'on' || raw === '1') return { ok: true, value: true }
      if (raw === 'false' || raw === '' || raw === '0') return { ok: true, value: false }
      return { ok: false, code: 'config.value-invalid' }
    },
    formatValue: (value) => (Boolean(value) ? 'Включено' : 'Выключено'),
  },
} as const satisfies Record<string, ConfigKeyInfo>

/** Ключ конфига, который читает код. */
export type ConfigKey = keyof typeof CONFIG_KEYS

export const ALL_CONFIG_KEYS: readonly ConfigKey[] = Object.keys(CONFIG_KEYS) as ConfigKey[]

const BY_FIELD_NAME = new Map<string, ConfigKey>(
  ALL_CONFIG_KEYS.map((k) => [CONFIG_KEYS[k].fieldName, k]),
)

/** Известен ли ключу бутстрап кода (ключ каталога)? */
export function isConfigKey(value: string): value is ConfigKey {
  return Object.hasOwn(CONFIG_KEYS, value)
}

/** Бутстрап-умолчание ключа; `undefined` — в коде умолчания нет. */
export function bootstrapOf(key: string): unknown {
  return isConfigKey(key) ? CONFIG_KEYS[key].bootstrap : undefined
}

/** Имя поля HTML-формы для ключа каталога (`snake_case` по политике `#lib/form`). */
export function fieldNameOf(key: ConfigKey): string {
  return CONFIG_KEYS[key].fieldName
}

/** Обратное отображение имени поля формы в ключ конфига. */
export function configKeyByFieldName(fieldName: string): ConfigKey | undefined {
  return BY_FIELD_NAME.get(fieldName)
}

/** Человекочитаемое значение параметра (для `read-only` строк и подсказки умолчания). */
export function formatConfigValue(key: ConfigKey, value: unknown): string {
  return CONFIG_KEYS[key].formatValue(value)
}

/** Валидация и приведение значения по спеке ключа каталога. */
export function decodeConfigValue(
  key: ConfigKey,
  raw: unknown,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly code: 'config.value-invalid' } {
  return CONFIG_KEYS[key].decodeValue(raw)
}
