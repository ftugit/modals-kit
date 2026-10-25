// Описание универсальной формы доказательства владения `seed` (`seedForm`),
// нарезанной на шаги через `formSteps`:
//   - `login` / `restore` (`authorize = true`): открывают сессию гостю;
//   - `confirm` (`authorize = false`): проверяет знание `seed` без создания
//     записи в `user_session` и без выдачи/смены кук (работает и для гостя,
//     и для авторизованного пользователя, сохраняющего свой текущий токен);
//   - `accept` / `logout` / `renew` / `challenge`: сервисные конверт-действия.
import { defineForm, field, v } from '#lib/form/index.js'
import { AUTH_MESSAGES } from '../../messages.js'
import { SEED_FORM_ID, SEED_FORM_REV } from './envelope.js'

export { SEED_FORM_ID, SEED_FORM_REV }

export const seedForm = defineForm({
  id: SEED_FORM_ID,
  revision: SEED_FORM_REV,
  // Ответы сессии — общий словарь модуля (`messages.ts`): одна строка на код
  // для всех его форм. Своё здесь только `pattern` — это про seed.
  messages: {
    ...AUTH_MESSAGES,
    'pattern': 'Это не seed: 43–44 знака — латиница, цифры, «-» и «_»',
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
