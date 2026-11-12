// Локальный выход: куки снимаются, сессия остаётся живой до истечения
// токена. Единственный сценарий экрана выхода, где набор сессий не нужен, —
// поэтому у формы нет ни одного поля: намерение несёт имя экшена.
import { defineForm } from '#lib/form/index.js'

export const LOGOUT_LOCAL_FORM_ID = 'user-logout-local'

export const logoutLocalForm = defineForm({
  id: LOGOUT_LOCAL_FORM_ID,
  revision: 1,
  actions: [{ id: 'local', label: 'Выйти', validate: 'partial', relax: ['required'] }],
  fields: {},
})
