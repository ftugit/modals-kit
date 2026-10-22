# Реестр устаревшего кода, временных решений и хвостов к удалению

Ведётся по ходу переработки модуля `src/content/user` и `src/hooks/component-form`,
чтобы в финальном проходе вычистить все остатки без единого забытого файла или символа.

---

## 1. Уже удалено

| Объект | Причина устаревания | Коммит удаления |
|---|---|---|
| `src/lib/server/component-forms.ts`, `src/lib/server/component-forms.test.ts` | Механизм форм компонентов не принадлежит `src/lib/*` и содержал временный flash-cookie слой; перенесён модулем в `src/hooks/component-form/` без flash-кук и `localStore`. | `d5b2951` |
| `src/lib/components/form/route-form.svelte.ts` | Перенесён в `src/hooks/component-form/client.svelte.ts` (`bindComponentForm`). | `d5b2951` |
| `src/routes/(site)/(app)/user/profile/+page.server.ts`, `+page.svelte` | Отдельный роут профиля отменён владельцем: редактирование живёт шагом `?stage=profile` и компонентом `ProfileForm` под `Acl allow="user"`. | `d5b2951` |
| `src/content/user/ui/ProfileModal.svelte`, `ProfileModalLazy.svelte`, регистрация `user.profile` в `src/routes/(site)/auth-modals.ts` | Дублировали шаг `profile` внутри `user.auth`. | `d5b2951` |
| Дублирующий `export const actions` в `src/routes/(site)/(app)/user/auth/+page.server.ts` | Перенесён в единый `src/content/user/server-forms.ts` через `registerComponentForm`. | `d5b2951` |
| Ручная сборка конверта `acceptRestrictions()` и кнопка «Выйти из аккаунта» внутри формы входа в `src/content/user/ui/AuthWidget.svelte`, пропсы `actionUrl` / `form` в `AuthWidget.svelte` и `AuthModal.svelte` | Заменены самостоятельными `AuthForm.svelte` (`Acl allow="guest"`), `BanNotice.svelte` (`Acl allow="guest"`) и `RestrictionsNotice.svelte` (`Acl allow="user"` + `bindComponentForm`). | Текущий шаг |

---

## 2. Ожидает замены / удаления на следующих шагах и в финальной зачистке

| Файл / символ | Что устарело | Когда убираем |
|---|---|---|
| `src/content/user/forms.ts` → `profileForm.fields.avatar = field.hidden(...)` | Временный строковый `dataURL`-носитель из `7149ce8` (см. `docs/design/image-transfer.md` `R2`). Заменяется на `field.photo(...)` (`File \| null`) с `check('photo:avatar')`. | Следующий шаг (`ProfileForm` + `File`) |
| `src/content/user/ui/ProfileForm.svelte` → `mirrorToField(bound, 'avatar', ...)` + текст `JS_ONLY_REASON` вместо именованного `<input type="file">` (`carrier`), отсутствие обёртки `<Acl allow="user">` | Переводится на `<Acl allow="user">` + именованный `carrier` (`no-JS` отправляет сырой `File`) + staging `FileAttachment` (`JS` жмёт в `File` и кладёт в `carrier` через `DataTransfer` + `f.onInput`). | Следующий шаг (`ProfileForm` + `File`) |
| `src/content/user/avatar.ts` → выдача `dataUrl: string` как основного результата для формы + `src/content/user/server-forms.ts` строковый приём `values.avatar` | Клиентский `prepareAvatar` должен отдавать `File` (`image/jpeg`) для `DataTransfer`, а серверный обработчик — принимать только `File`, проверять `probe` и сжимать на сервере (`R3`), не принимая сырые `base64`-строки из запроса. | Следующий шаг (`ProfileForm` + `File`) |
| `src/routes/(site)/(app)/user/menu/+page.server.ts` → ручной `if (!user) redirect(303, ...)` | Дублирует проверку доступа: сам `MenuBody.svelte` уже обёрнут в `<Acl allow="user">`. Проверить и убрать лишний редирект роута (оставив чистый `load`), если страница `/user/menu` должна рендерить экран `Acl`. | Финальная зачистка |
| `src/content/user/error.ts` → `demoFacts()` (`строка 108`) и устаревший комментарий у `'auth.confirm'` (`// подтверждение не прошло (удаление аккаунта)`) | `demoFacts()` — времянка эмуляции хода 251 (проверить ссылки в тестах и удалить, если не нужна контракту); `requestDelete` работает по `guard(accessToken)` без `seed`. | Финальная зачистка |
| `docs/design/profile-form-fix.md`, рабочие заметки в `docs/design/profile-and-hooks-qa.md` | Свести актуальные решения в постоянную документацию модуля (`src/content/user/README.md`, `docs/plan.md`) и удалить временные черновики. | Финальная зачистка |
| Старые тесты (`src/content/user/ui/ProfileForm.svelte.test.ts`, шаг 8 в `test/browser/auth.mjs`) | Ожидают строковый `base64` в скрытом поле и кнопку «Выйти из аккаунта» внутри гостевой формы `/user/auth` вместо `File` и экрана `Acl`. | Этап тестов + финальная зачистка |
