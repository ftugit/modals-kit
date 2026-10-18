// Описание ЕДИНСТВЕННОЙ формы пользователя: шаги (вход, создание, восстановление,
// профиль, ограничения) — одна форма, различаются интентом нажатой кнопки.
// Изоморфное: импортируют и виджет, и серверное действие. Ноль UI, ноль HTTP.
import { buildEnvelope, defineForm, field, v } from '#lib/form/index.js'

export const AUTH_FORM_ID = 'user-auth'
export const AUTH_FORM_REV = 1

/**
 * Конверт для программных отправок мимо разметки (vault: продление; меню:
 * выход) — те же имена, что рисует `bind.hidden()` в форме.
 */
export function authEnvelope(instance: string): Record<string, string> {
  return buildEnvelope({
    formId: AUTH_FORM_ID,
    revision: AUTH_FORM_REV,
    instance,
    submissionId: crypto.randomUUID(),
  })
}

/**
 * Поля — полный состав всех шагов; шаг показывает свои, остальные скрыты или
 * пусты. Обязательность решает сервер (шагу известен контекст), правила длины —
 * здесь: они верны на любом шаге.
 */
export const authForm = defineForm({
  id: AUTH_FORM_ID,
  revision: AUTH_FORM_REV,
  actions: [
    { id: 'login', label: 'Войти', validate: 'full' },
    { id: 'register', label: 'Создать аккаунт', validate: 'full' },
    { id: 'restore', label: 'Восстановить аккаунт', validate: 'full' },
    { id: 'profile', label: 'Сохранить профиль', validate: 'full', relax: ['required'] },
    { id: 'skip-profile', label: 'Пропустить профиль', validate: 'partial', relax: ['required'] },
    { id: 'accept', label: 'Принято', validate: 'partial' },
    { id: 'logout', label: 'Выйти', validate: 'partial' },
    { id: 'renew', label: 'Продлить', validate: 'partial' },
    { id: 'challenge', label: 'Свежий nonce', validate: 'partial' },
  ],
  fields: {
    seed: field.text({
      label: 'Seed',
      help: 'Единственный ключ от аккаунта — храните в менеджере секретов',
      validate: [v.minLength(43), v.maxLength(44)],
    }),
    nonce: field.hidden({ label: 'Nonce' }),
    signature: field.hidden({ label: 'Подпись' }),
    nickname: field.text({
      label: 'Никнейм',
      validate: [v.maxLength(32)],
    }),
    avatar: field.hidden({ label: 'Аватар' }),
  },
})
