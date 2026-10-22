# Реестр устаревшего кода, временных решений и хвостов к удалению

Ведётся непрерывно по ходу переработки модуля `src/content/user` и `src/hooks/component-form`,
чтобы в финальном проходе вычистить все остатки без единого забытого файла, типа или комментария.

---

## 1. Уже удалено

| Объект | Причина устаревания | Коммит удаления |
|---|---|---|
| `src/lib/server/component-forms.ts`, `src/lib/server/component-forms.test.ts` | Механизм форм компонентов не принадлежит `src/lib/*` и содержал временный flash-cookie слой; перенесён модулем в `src/hooks/component-form/` без flash-кук и `localStore`. | `d5b2951` |
| `src/lib/components/form/route-form.svelte.ts` | Перенесён в `src/hooks/component-form/client.svelte.ts` (`bindComponentForm`). | `d5b2951` |
| `src/routes/(site)/(app)/user/profile/+page.server.ts`, `+page.svelte` | Отдельный роут профиля отменён владельцем: редактирование живёт шагом `?stage=profile` и компонентом `ProfileForm` под `Acl allow="user"`. | `d5b2951` |
| `src/content/user/ui/ProfileModal.svelte`, `ProfileModalLazy.svelte`, регистрация `user.profile` в `src/routes/(site)/auth-modals.ts` | Дублировали шаг `profile` внутри `user.auth`. | `d5b2951` |
| Дублирующий `export const actions` в `src/routes/(site)/(app)/user/auth/+page.server.ts` | Перенесён в единый `src/content/user/server-forms.ts` через `registerComponentForm`. | `d5b2951` |
| Ручная сборка конверта `acceptRestrictions()` и кнопка «Выйти из аккаунта» внутри формы входа в `src/content/user/ui/AuthWidget.svelte`, пропсы `actionUrl` / `form` в `AuthWidget.svelte` и `AuthModal.svelte` | Заменены самостоятельными `SeedForm.svelte`, `BanNotice.svelte` (`Acl allow="guest"`) и `RestrictionsNotice.svelte` (`Acl allow="user"` + `bindComponentForm`). | `a1a0567` |
| `src/content/user/ui/AuthForm.svelte`, символы `authForm`, `AUTH_FORM_ID`, `AUTH_FORM_REV`, `authEnvelope`, `authEnvelopeFields` в `src/content/user/forms.ts` | Эволюционировали в универсальную `SeedForm.svelte` + `seedForm` (`SEED_FORM_ID`, `SEED_FORM_REV`, `seedEnvelope`, `seedEnvelopeFields`) с нарезкой `formSteps` и параметром `authorize` (`true` → `<Acl allow="guest">` + открытие сессии; `false` → `<Acl allow="user">` + `confirmSeed` без перевыпуска сессии). | Текущий шаг |
| `profileForm.fields.avatar = field.hidden(...)`, `mirrorToField(bound, 'avatar', ...)`, заглушка `JS_ONLY_REASON` в `src/content/user/ui/ProfileForm.svelte`, строковый приём `values.avatar` в `src/content/user/server-forms.ts` | Переведены на `field.photo(...)` (`File \| null`) с `photoImage('avatar')`, `<Acl allow="user">`, `AvatarTakeover.svelte` (`DataTransfer` + `f.pending` + `f.error`), и серверный `prepareServerAvatar` (`src/content/user/server-avatar.ts`) — никакие внешние `base64`-строки по сети больше не передаются и отклоняются сервером. | Текущий шаг |

---

## 2. Осталось для финальной зачистки и полного прогона тестов (Финальный шаг)

| Файл / символ | Что устарело | Действие в финальном проходе |
|---|---|---|
| `src/routes/(site)/(app)/user/menu/+page.server.ts` | Ручной `if (!user) redirect(303, ...)` дублирует проверку прав — сам `MenuBody.svelte` уже обёрнут в `<Acl allow="user">`. | Убрать лишний редирект роута, оставив чистый `load`, чтобы прямая навигация гостя на `/user/menu` показывала экран `Acl` единообразно с остальными роутами. |
| `src/content/user/error.ts` → `demoFacts()` и устаревшие комментарии | Времянка эмуляции хода 251 (`demoFacts()`) и устаревший комментарий у `'auth.confirm'`. | Проверить по всему репозиторию отсутствие живых потребителей `demoFacts()`, вычистить мёртвый код и устаревшие комментарии. |
| `src/content/user/config.ts` → комментарий у `avatarFormats` | Комментарий описывал старый приём `base64` с клиента; теперь входные форматы задаются `SERVER_PHOTO_FORMATS`, а `avatarFormats` в БД фиксирует выходной формат внутреннего хранения (`jpeg`). | Уточнить JSDoc в `config.ts` и `profile.ts`. |
| `test/browser/auth.mjs` (строки 48–280, особенно шаг 8 аватара и проверка гостевого экрана `/user/auth`) | Тест ждёт строковый `input[name=avatar].value = 'data:image/jpeg;base64,...'` и кнопку «Выйти из аккаунта» внутри формы `/user/auth` вместо бинарного `File` / `DataTransfer`, `no-JS` отправки `File` и экрана `Acl`. | Обновить `test/browser/auth.mjs` под `SeedForm` (`Acl`), бинарный `File` аватара (JS + `no-JS`), запрет внешних `base64`-строк и прогнать весь suite целиком. |
| Документация (`src/content/user/README.md`, `docs/plan.md`, черновики `docs/design/profile-form-fix.md` / `docs/design/profile-and-hooks-qa.md`) | Часть таблиц ещё упоминает `authForm`, `ProfileModal`, `/user/profile` и `base64` скрытое поле. | Актуализировать постоянную документацию модуля и удалить устаревшие рабочие заметки. |
