// Описание универсальной формы доказательства владения `seed` (`seedForm`),
// нарезанной на шаги через `formSteps`:
//   - `login` / `restore` (`authorize = true`): открывают сессию гостю;
//   - `confirm` (`authorize = false`): проверяет знание `seed` без создания
//     записи в `user_session` и без выдачи/смены кук (работает и для гостя,
//     и для авторизованного пользователя, сохраняющего свой текущий токен);
//   - `accept` / `logout` / `renew` / `challenge`: сервисные конверт-действия.
import { defineForm, field, v } from '#lib/form/index.js'
import { SEED_FORM_ID, SEED_FORM_REV } from './envelope.js'

export { SEED_FORM_ID, SEED_FORM_REV }

export const seedForm = defineForm({
  id: SEED_FORM_ID,
  revision: SEED_FORM_REV,
  messages: {
    'auth.disabled': 'Вход выключен: на сервере не задан AUTH_SEAL_SECRET — сессии нечем запечатывать',
    'pattern': 'Это не seed: 43–44 знака — латиница, цифры, «-» и «_»',
    'auth.nonce-unknown': 'Время подтверждения истекло — попробуйте ещё раз',
    'auth.signature': 'Seed или подпись не сошлись — проверьте ввод',
    'auth.identity-unknown': 'Аккаунта с таким seed больше нет',
    'auth.token': 'Сессия повреждена — войдите заново',
    'auth.expired': 'Время сессии вышло — войдите заново',
    'auth.revoked': 'Сеанс завершён на этом устройстве',
    'auth.session-unknown': 'Сессия не найдена — войдите заново',
    'auth.blocked': 'Аккаунт заблокирован',
    'auth.delete-pending': 'Заявка на удаление ещё активна',
    'auth.deleted': 'Аккаунт удалён — его можно восстановить, пока seed не стёрт',
    'auth.confirm': 'Что-то пошло не так — попробуйте ещё раз',
  },
  actions: [
    { id: 'login', label: 'Войти', validate: 'full' },
    { id: 'restore', label: 'Восстановить аккаунт', validate: 'full' },
    { id: 'confirm', label: 'Подтвердить владение', validate: 'full' },
    { id: 'accept', label: 'Принято', validate: 'partial', relax: ['required'] },
    { id: 'logout', label: 'Выйти', validate: 'partial', relax: ['required'] },
    { id: 'renew', label: 'Продлить', validate: 'partial', relax: ['required'] },
    { id: 'challenge', label: 'Свежий nonce', validate: 'partial', relax: ['required'] },
  ],
  fields: {
    seed: field.text({
      label: 'Seed',
      help: 'Единственный ключ от аккаунта — храните в менеджере секретов',
      validate: [v.required(), v.pattern({ source: '[A-Za-z0-9_-]{43,44}' })],
    }),
    nonce: field.hidden({ label: 'Nonce' }),
    signature: field.hidden({ label: 'Подпись' }),
  },
})
