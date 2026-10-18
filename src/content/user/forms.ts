// Описание ЕДИНСТВЕННОЙ формы пользователя: шаги (вход, создание, восстановление,
// профиль, ограничения) — одна форма, различаются интентом нажатой кнопки.
// Изоморфное: импортируют и виджет, и серверное действие. Ноль UI, ноль HTTP.
import { buildEnvelope, defineForm, field, v, type Envelope } from '#lib/form/index.js'

export const AUTH_FORM_ID = 'user-auth'
export const AUTH_FORM_REV = 2

/**
 * Конверт для программных отправок мимо разметки (vault: продление; меню:
 * выход) — те же имена, что рисует `bind.hidden()` в форме.
 */
export function authEnvelope(instance: string): Envelope {
  return { formId: AUTH_FORM_ID, revision: AUTH_FORM_REV, instance, submissionId: crypto.randomUUID(), intent: 'submit' }
}

/** Поля конверта для FormData программной отправки (те же имена, что в разметке). */
export function authEnvelopeFields(envelope: Envelope): Record<string, string> {
  const { intent: _intent, ...rest } = envelope
  return buildEnvelope(rest)
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
    // единственный pattern формы — seed; текст свой, не общий словарный
    'pattern': 'Это не seed: 43–44 знака — латиница, цифры, «-» и «_»',
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
    // restore живёт правами куки: поле seed на шаге не показано — required отдыхает
    { id: 'restore', label: 'Восстановить аккаунт', validate: 'full', relax: ['required'] },
    { id: 'profile', label: 'Сохранить профиль', validate: 'full', relax: ['required'] },
    { id: 'skip-profile', label: 'Пропустить профиль', validate: 'partial', relax: ['required'] },
    { id: 'accept', label: 'Принято', validate: 'partial', relax: ['required'] },
    // Сервисные действия (logout/challenge/renew/accept) работают в формах, где
    // поля входа не рисуются или пусты (меню, фон, ограничения): seed с хода 258
    // обязан быть непустым (required), и без relax ЛЮБОЙ такой поход падал на
    // seed.required ещё до execute (замечено ходом 261, тесты 9а/14; у
    // restore/profile relax стоял изначально).
    { id: 'logout', label: 'Выйти', validate: 'partial', relax: ['required'] },
    { id: 'renew', label: 'Продлить', validate: 'partial', relax: ['required'] },
    { id: 'challenge', label: 'Свежий nonce', validate: 'partial', relax: ['required'] },
  ],
  fields: {
    seed: field.text({
      label: 'Seed',
      help: 'Единственный ключ от аккаунта — храните в менеджере секретов',
      // пустое и «набор символов» ловит форма (ход 258): у minLength/maxLength
      // пустое значение проходило, и шаг отходил серверу — тот молчал в скрытое поле
      validate: [v.required(), v.pattern({ source: '[A-Za-z0-9_-]{43,44}' })],
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
