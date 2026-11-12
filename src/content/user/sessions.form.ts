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

/** Все свои, кроме текущей. Намерение задаёт экшен `?/others`, не поле. */
export function sessionRevokeOthersForm() {
  return defineForm({
    id: SESSION_REVOKE_OTHERS_FORM_ID,
    revision: 1,
    fields: {
      scope: field.hidden({
        defaultValue: 'others',
        validate: [v.required()],
      }),
    },
  })
}

/** Набор массового выхода: что закрываем. Пустой `pick` — весь срез цели. */
export type SessionBulkExitShape = {
  /** `only` — ровно перечисленные, `except` — все, кроме перечисленных. */
  pick?: 'only' | 'except' | null
  ids?: readonly string[]
  /** Начальное состояние чекбокса «включая текущую»: им носитель задаёт инверсию. */
  includeCurrent?: boolean
  /**
   * Чекбокс расширяет набор, а не впускает текущую сессию. Список сессий
   * закрывает показанные строки и чекбоксом добавляет к ним текущую; экран
   * выхода закрывает одну текущую сессию и чекбоксом раздвигает набор до
   * всего аккаунта. Один компонент, две инверсии — разница только в этом флаге.
   */
  spread?: boolean
  /** Подпись чекбокса: у списка и у экрана выхода он разный. */
  checkboxLabel?: string
}

/** Предел набора: столько же, сколько принимает домен. */
export const SESSION_BULK_IDS_MAX = 500

/**
 * Форма массового выхода. Одна на оба носителя — список сессий и экран выхода:
 * различаются только значения по умолчанию, а не набор полей. Это и есть
 * «инверсия себя же»: чекбокс «включая текущую» меняет набор, а не экран.
 *
 * Намерение теперь задаёт поле, а не имя экшена — иначе «закрыть всё, что в
 * списке после фильтрации» выразить нечем.
 */
export function sessionBulkExitForm(opts: SessionBulkExitShape = {}) {
  return defineForm({
    id: SESSION_REVOKE_OTHERS_FORM_ID,
    revision: 2,
    actions: [{ id: 'bulk-exit', label: 'Завершить', validate: 'partial', relax: ['required'] }],
    fields: {
      /** Снимать и текущую сессию зрителя. */
      include_current: field.checkbox({
        label: opts.checkboxLabel ?? 'Закрыть и текущую сессию',
        defaultValue: opts.includeCurrent ?? false,
      }),
      pick: field.hidden({ defaultValue: opts.pick ?? '' }),
      ids: field.hidden({ defaultValue: (opts.ids ?? []).join(',') }),
      /** `1` — чекбокс раздвигает набор до всего аккаунта (экран выхода). */
      spread: field.hidden({ defaultValue: opts.spread ? '1' : '' }),
    },
  })
}

const TRUE_VALUES = new Set(['1', 'on', 'true', 'yes'])

/**
 * Аргументы домена из значений формы. Чистая функция: екшен её вызывает, тест
 * гоняет без SvelteKit.
 *
 * Чекбокс «включая текущую» снят — текущая выходит из набора: в `only` она
 * удаляется из списка, в `except` попадает в исключения. Отсюда же следует,
 * что без JS форма работает: и чекбокс, и отправка на одном экране.
 */
export function bulkExitArgs(
  values: Record<string, unknown>,
  currentId: string | null,
): { scope: 'others' | 'all'; pick: 'only' | 'except' | null; ids: readonly string[] } {
  const raw = String(values.pick ?? '').trim().toLowerCase()
  const pick = raw === 'only' || raw === 'except' ? raw : null
  const include =
    values.include_current === true || TRUE_VALUES.has(String(values.include_current ?? '').trim().toLowerCase())
  const spread = TRUE_VALUES.has(String(values.spread ?? '').trim().toLowerCase())

  // Экран выхода: отмеченный чекбокс — весь аккаунт, снятый — одна текущая
  // сессия. Набор считает сервер, поэтому no-JS (без JS скрытые поля не
  // переписываются по чекбоксу) получает тот же исход, что и браузер.
  if (spread) {
    if (!include) return { scope: 'all', pick: 'only', ids: currentId ? [currentId] : [] }
    return { scope: 'all', pick: 'except', ids: [] }
  }

  const seen = new Set<string>()
  for (const part of String(values.ids ?? '').split(',')) {
    const id = part.trim().toLowerCase()
    if (id) seen.add(id)
    if (seen.size >= SESSION_BULK_IDS_MAX) break
  }
  // Чекбокс «включая текущую» инвертирует набор, а не экран: в `only` снятый
  // чекбокс убирает текущую из набора, в `except` — добавляет её в исключения.
  if (pick && currentId) {
    if (include) {
      if (pick === 'except') seen.delete(currentId)
    } else if (pick === 'only') seen.delete(currentId)
    else seen.add(currentId)
  }
  return { scope: pick || include ? 'all' : 'others', pick, ids: [...seen] }
}
