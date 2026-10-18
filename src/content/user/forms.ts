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
  // Тексты доменных кодов — ЗДЕСЬ (сервер наполнит message при сборе отказа):
  // карта в виджете — велосипед поверх движка (ход 251, аудит).
  messages: {
    'auth.disabled': 'Вход выключен: на сервере не задан AUTH_SEAL_SECRET — сессии нечем запечатывать',
    'auth.nonce-unknown': 'Время на вход истекло — попробуйте ещё раз',
    'auth.signature': 'Seed или подпись не сошлись — проверьте ввод',
    'auth.identity-unknown': 'Аккаунта с таким seed больше нет',
    'auth.token': 'Сессия повреждена — войдите заново',
    'auth.expired': 'Время сессии вышло — войдите заново',
    'auth.revoked': 'Сеанс завершён на этом устройстве',
    'auth.session-unknown': 'Сессия не найдена — войдите заново',
    'auth.blocked': 'Аккаунт заблокирован',
    'auth.delete-pending': 'Заявка на удаление ещё активна',
    'auth.confirm': 'Что-то пошло не так — попробуйте ещё раз',
    'profile.nickname-forbidden': 'Такой никнейм нельзя: 2–32 знака, без служебных имён (admin, root, …)',
    'profile.avatar-format': 'Это не картинка или формат не из разрешённых (jpeg, png, webp)',
    'profile.avatar-size': 'Картинка не сжимается до нужного веса — возьмите другую',
  },
  actions: [
    { id: 'login', label: 'Войти', validate: 'full' },
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
