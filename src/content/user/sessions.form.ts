/**
 * Отзыв своих устройств. Описание общее для экрана и экшена: без JS это
 * обычный POST, идентификатор едет скрытым полем, не адресом.
 */
import { defineForm, field, v } from '#lib/form/index.js'

export const SESSION_REVOKE_FORM_ID = 'user-session-revoke'
export const SESSION_REVOKE_OTHERS_FORM_ID = 'user-session-revoke-others'
export const SESSION_RENAME_FORM_ID = 'user-session-rename'

/**
 * Переименование устройства. `device_name` — единственное поле строки,
 * которое человек с правом правки может менять; пустое значение домен
 * превращает в `null` («Без имени»).
 */
export function sessionRenameForm(id: string) {
  return defineForm({
    id: SESSION_RENAME_FORM_ID,
    revision: 1,
    fields: {
      id: field.hidden({
        defaultValue: id,
        validate: [v.required(), v.maxLength(36)],
      }),
      device_name: field.text({
        label: 'Название устройства',
        defaultValue: '',
        validate: [v.maxLength(60)],
      }),
    },
  })
}

/** Одна сессия. `id` — публичный идентификатор строки, не `jti`. */
export function sessionRevokeForm(id: string) {
  return defineForm({
    id: SESSION_REVOKE_FORM_ID,
    revision: 1,
    fields: {
      id: field.hidden({
        defaultValue: id,
        validate: [v.required(), v.maxLength(36)],
      }),
    },
  })
}

/** Набор массового выхода: что закрываем. Состав считает сервер по фильтру. */
export type SessionBulkExitShape = {
  /** Начальное состояние чекбокса «включая текущую»: им носитель задаёт инверсию. */
  includeCurrent?: boolean
  /**
   * Чекбокс расширяет набор до всего аккаунта (экран выхода), а не впускает
   * текущую сессию в показанный список. Один компонент, две инверсии.
   */
  spread?: boolean
  /** Подпись чекбокса: у списка и у экрана выхода он разный. */
  checkboxLabel?: string
  /** Фильтр списка, который сервер применит в момент POST (те же имена, что у пагинатора). */
  filters?: Partial<Record<'state' | 'net' | 'country' | 'cfrom' | 'cto' | 'sfrom' | 'sto', string>>
}

/** Предел исключений — одно объявление в домене (`types.ts`). */
export { SESSIONS_BULK_IDS_LIMIT as SESSION_BULK_IDS_MAX } from './types.js'

/**
 * Форма массового выхода. Одна на оба носителя — список сессий и экран выхода.
 * Клиентские `ids`/`pick` удалены: разметка не посылает состав набора, сервер
 * считает его по фильтру из POST. Единственный пользовательский тик —
 * `include_current`; `spread` меняет инверсию чекбокса на экране выхода.
 */
export function sessionBulkExitForm(opts: SessionBulkExitShape = {}) {
  const f = opts.filters ?? {}
  return defineForm({
    id: SESSION_REVOKE_OTHERS_FORM_ID,
    revision: 3,
    actions: [{ id: 'bulk-exit', label: 'Завершить', validate: 'partial', relax: ['required'] }],
    fields: {
      include_current: field.checkbox({
        label: opts.checkboxLabel ?? 'Закрыть и текущую сессию',
        defaultValue: opts.includeCurrent ?? false,
      }),
      spread: field.hidden({ defaultValue: opts.spread ? '1' : '' }),
      state: field.hidden({ defaultValue: f.state ?? '' }),
      net: field.hidden({ defaultValue: f.net ?? '' }),
      country: field.hidden({ defaultValue: f.country ?? '' }),
      cfrom: field.hidden({ defaultValue: f.cfrom ?? '' }),
      cto: field.hidden({ defaultValue: f.cto ?? '' }),
      sfrom: field.hidden({ defaultValue: f.sfrom ?? '' }),
      sto: field.hidden({ defaultValue: f.sto ?? '' }),
    },
  })
}

const TRUE_VALUES = new Set(['1', 'on', 'true', 'yes'])
const STATES = ['active', 'expired', 'all', 'revoked'] as const
type State = (typeof STATES)[number]

const dateMs = (raw: string): number | null => {
  if (!raw) return null
  const v = Date.parse(raw)
  return Number.isFinite(v) ? v : null
}

/**
 * Аргументы домена из значений формы. Чистая функция: экшен её вызывает, тест
 * гоняет без SvelteKit. Состав набора (`ids`) не читается: сервер применяет
 * фильтр сам. `except` остаётся только как серверный контракт исключений.
 */
export function bulkExitArgs(
  values: Record<string, unknown>,
  currentId: string | null,
): {
  where: import('./sessions.server.js').SessionsWhereArgs
  except: readonly string[]
  includeCurrent: boolean
  onlyCurrent: boolean
} {
  const str = (key: string) => String(values[key] ?? '').trim()
  const include =
    values.include_current === true || TRUE_VALUES.has(str('include_current').toLowerCase())
  const spread = TRUE_VALUES.has(str('spread').toLowerCase())

  // Экран выхода: снятый чекбокс — одна текущая сессия (id сервер знает сам),
  // отмеченный — весь активный срез аккаунта. Клиентские ids не участвуют.
  if (spread) {
    return { where: { state: 'active' }, except: [], includeCurrent: include, onlyCurrent: !include }
  }

  const stateRaw = str('state')
  const state = (STATES as readonly string[]).includes(stateRaw) ? (stateRaw as State) : undefined
  const country = [...new Set(str('country').split(',').map((c) => c.trim()).filter(Boolean))]
    .slice(0, 20)
    .map((c) => (c === 'none' ? 'none' : c.toUpperCase()))
  const net = TRUE_VALUES.has(str('net').toLowerCase())
  const cfrom = str('cfrom')
  const cto = str('cto')
  const sfrom = str('sfrom')
  const sto = str('sto')
  return {
    where: {
      state,
      country,
      subnetChanged: net,
      createdFrom: dateMs(cfrom),
      createdTo: dateMs(cto),
      seenFrom: dateMs(sfrom),
      seenTo: dateMs(sto),
    },
    except: [],
    includeCurrent: include,
    onlyCurrent: false,
  }
}
