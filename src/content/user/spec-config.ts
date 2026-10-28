/**
 * Каталог ключей конфига, которые читает код, — единая точка текстов и
 * бутстрап-умолчаний. Схемы прав ключей каталог НЕ задаёт: они хранятся
 * в самой конфиг-модели (строка умолчания, поле `schema`) и меняются
 * через конфиг-API (`config-api.ts`). Здесь — только то, что нужно коду
 * потребителя: человеческий текст для экранов и значение, действующее,
 * пока в БД нет ни строки умолчания, ни переопределения юзера
 * (отсутствие строк конфига приложение не ломает). По образцу
 * `spec-block.ts`: тексты не размазаны по компонентам.
 */

/** Как ключ показывать человеку и что действует без строк в БД. */
export interface ConfigKeyInfo {
  readonly title: string
  readonly description: string
  /** Бутстрап-умолчание кода; нет поля — у ключа умолчания в коде нет. */
  readonly bootstrap?: unknown
}

/** Ключи, которые читает код. Ключ вне каталога — только данные (раздел управления, свой потребитель). */
export const VISIBILITY_KEY = 'profile.visibility'

export const CONFIG_KEYS = {
  'profile.visibility': {
    title: 'Кто видит профиль',
    description: 'all — все, включая гостей; users — только вошедшие; nobody — владелец и держатели прав.',
    bootstrap: 'nobody',
  },
  'session.ipLock': {
    title: 'Автовыход при смене IP',
    description: 'Сессия завершается, если адрес сменился. Закрепляется администратором, владельцу — только чтение.',
    bootstrap: false,
  },
} as const satisfies Record<string, ConfigKeyInfo>

/** Ключ конфига, который читает код. */
export type ConfigKey = keyof typeof CONFIG_KEYS

/** Известен ли ключу бутстрап кода (ключ каталога)? */
export function isConfigKey(value: string): value is ConfigKey {
  return Object.hasOwn(CONFIG_KEYS, value)
}

/** Бутстрап-умолчание ключа; `undefined` — в коде умолчания нет. */
export function bootstrapOf(key: string): unknown {
  return isConfigKey(key) ? CONFIG_KEYS[key].bootstrap : undefined
}
