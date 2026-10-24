# Реестр на тестирование и доработку (`TB-01` .. `TB-15`)

Актуализировано по итогам завершения этапов **`AS-01` .. `AS-09`** ([`auth-session.md`](./auth-session.md)), **`S1` → `S6`** ([`architecture.md`](./architecture.md), [`ui-consistency.md`](./ui-consistency.md)) и полного сквозного прогона статических, unit- и браузерных тестов.

---

## Сводная таблица статусов

| ID | Приоритет | Статус | Актуальные файлы (`S5`) | Суть и фактическое состояние |
|---|---|---|---|---|
| `TB-01` | **P0** | `[ ]` Открыто | `src/content/user/auth.ts`, `src/content/user/ui/profile-form/profile.form.server.ts` | `data:image/jpeg;base64,…` аватара упаковывается в куку `auth_tmp` → риск превышения `4096 B` (RFC 6265) / `431` на реальных цветных фото (см. этап `R6` в [`../design/image-transfer.md`](../design/image-transfer.md)). |
| `TB-02` | **P0** | `[x]` Закрыто (`AS-02`) | `src/content/user/{auth.ts,gateway.server.ts}`, `src/content/user/ui/{AuthWidget.svelte,seed-form/SeedForm.svelte}` | Свежий одноразовый `challenge` возвращается в `data` при отказе `proveSeed` и подхватывается в `AuthWidget` и автономном `<SeedForm />` без перезагрузки страницы. |
| `TB-03` | **P0** | `[x]` Закрыто (`AS-03`) | `src/content/user/gateway.server.ts`, `src/routes/(site)/+layout.server.ts` | SSR проверяет живую сессию через `guard()` и прозрачно восстанавливает срез по `auth_sid` (проверено E2E `test/browser/auth.mjs`). |
| `TB-04` | **P1** | `[ ]` Открыто | `src/content/user/gateway.server.ts` | Перевести `challenge.consume()` на атомарное чтение-удаление в `sharedStore` (`cache_kv`) вместо `get` + `delete` в `localStore` для multi-instance деплоя. |
| `TB-05` | **P1** | `[~]` Частично (`AS-05`) | `src/content/user/gateway.server.ts` | **Закрыта критичная часть:** `logout()` и `logoutAll()` передают `renewal()` в ядро и отзывают сессию в БД даже при мёртвой `auth_tmp` (покрыто `test/browser/auth.mjs`). **Осталось:** выводить флаг `secure` у кук из HTTPS-протокола запроса / env. |
| `TB-06` | **P1** | `[~]` Частично (`S4`) | `src/hooks/component-form/server.server.ts` | **Исправлен баг чужого `formId`:** при `raw === 'too-large'` больше не выбирается первая форма реестра (`user-seed`), сервер сразу отдаёт честный `413`. **Осталось:** раннее чтение `__form_id` для индивидуального `maxBytes` лёгких форм. |
| `TB-07` | **P1** | `[x]` Закрыто (`S4`) | `src/hooks/component-form/client.svelte.ts` | `resolveTarget = () => action ?? readCurrentHref()` читает актуальный видимый URL динамически на каждую отправку вместо замороженного `untrack`. |
| `TB-08` | **P2** | `[ ]` Открыто | `src/content/user/ui/profile-form/{ProfileForm.svelte,AvatarTakeover.svelte}` | Добавить явную плашку «Текущее фото будет удалено — Отменить» для `remove_avatar` до нажатия «Сохранить» и автосброс при выборе нового файла. |
| `TB-09` | **P1** | `[x]` Закрыто (`AS-09`) | `src/content/user/ui/{AuthWidget.svelte,profile-form/ProfileForm.svelte}` | Живой клиентский `vault.profile` имеет приоритет над начальным SSR-снимком `initial` (`vault.authorized ? vault.profile : (initial ?? vault.profile)`). |
| `TB-10` | **P2** | `[~]` Частично (`S4` / `R5`) | `src/routes/(site)/(app)/fields/{forms.ts,fields.form.server.ts}` | Ручной `sniff()` удалён и заменён на `probeImageHeader` (`#lib/image/probe.js`); полный переход поля на `field.photo(...)` с проверкой `maxSide`/`maxPixels` описан в этапе `R5` ([`../design/image-transfer.md`](../design/image-transfer.md)). |
| `TB-11` | **P2** | `[ ]` Открыто | `src/content/user/ui/profile-form/profile.form.server.ts`, `src/content/user/{profile.ts,config.ts,checks.ts}` | Синхронизировать входной список форматов `ProfileForm` с динамическим `userConfig.get('avatarFormats')`. |
| `TB-12` | **P2** | `[ ]` Открыто | `src/content/user/ui/profile-form/profile.form.server.ts`, `src/content/user/profile.ts` | Различать очистку поля `nickname` (`''` → `null`) и отсутствие изменения (`undefined`). |
| `TB-13` | **P2** | `[ ]` Открыто | `src/hooks/component-form/server.server.ts` | Заменить поверхностный spread `{ ...event, request }` в `renderInlineWithResult` на `Object.create(Object.getPrototypeOf(event), ...)` или `Proxy`, сохраняющий геттеры прототипа `RequestEvent`. |
| `TB-14` | **P2** | `[ ]` Открыто | `src/content/user/{auth.ts,gateway.server.ts}` | Подключить периодический вызов `sweepDeletions(ports)` и актуализировать верхний комментарий `gateway.server.ts`. |
| `TB-15` | **P3** | `[x]` Закрыто (`S5`–`S6`) | весь репозиторий | Пройден полный контур *(числа — срез на момент закрытия; текущие даёт прогон)*: `test:guard` (`128/128`), `test:classes` (`0` маркеров), `svelte-check` (`0 errors, 0 warnings`), `vitest` (`111/111` файлов, `1355/1355` тестов), `test:db:probes`, `vite build`, `test:size` и все `11/11` E2E-наборов Playwright (включая `attachment.mjs` на `vite dev` и `shikimori.mjs`). |

---

## Оставшиеся открытые задачи для следующих итераций

1. **`TB-01` (`R6`) — вынос байтов аватара из куки `auth_tmp`:** хранить в `auth_tmp` только компактный идентификатор/ревизию аватара и отдавать изображение кэшируемым GET-роутом `/api/user/avatar/...`, чтобы не превышать `4096 B` на куку.
2. **`TB-04` + `TB-05` (часть 2) — hardening `gateway.server.ts` под multi-instance HTTPS:** атомарный `challenge.consume()` в `sharedStore` (`cache_kv`) и вывод `secure: url.protocol === 'https:'` для `COOKIE_BASE`.
3. **`TB-08` + `TB-11` + `TB-12` — UX и краевые случаи `ProfileForm`:** обратимое состояние `remove_avatar`, очистка `nickname` в `null` и единый источник `avatarFormats` из `userConfig`.
4. **`TB-06` (часть 2) + `TB-13` — полировка `src/hooks/component-form/server.server.ts`:** сохранение прототипа `RequestEvent` при inline-рендере и ранний лимит байт по конкретному `__form_id`.
5. **`TB-10` (`R5`) + `TB-14`:** полный перевод `/fields` на `field.photo` с лимитом пикселей и подключение фонового `sweepDeletions(ports)`.
