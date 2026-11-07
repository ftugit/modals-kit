# План: экраны на `Surface` и единая форма серверов хранилища

Статус: **этапы 1 и 2 закрыты; этапы 3 и 4 не начаты.** Код этапов 3–4 — только по отдельной команде владельца. Закрытая история этапов 1–2 в этом файле не хранится.

| Этап | Состояние | Коммиты |
| --- | --- | --- |
| 1 — модалки и пагинатор, текст ошибки по статусу | закрыт 2026-11-01 | `5bda344`, `06a38ff`, `1bddb6b`, `0bed0ae`, `1a3bf60`, `c200e52` |
| 2 — `Surface` / `SurfaceBar`, носители модалок | закрыт 2026-11-01 | `bb8908b`, `19eacf3`, `dd25c34` |
| 3 — экраны ядра на `Surface` | не начат | — |
| 4 — одна форма серверов хранилища | решения приняты, код не начат | — |

Порядок: этап 4 опирается на этап 3, потому что общая форма рисуется через `Surface`. Один этап — один локальный коммит.

Уже есть и не переписывается: `src/components/ui/surface/` (`Surface`, `SurfaceBar`, `surfaceVariants`), реэкспорт в `#components/ui`, носители `*Modal.svelte` на `variant="plain"`. Временный реэкспорт `userSurfaceVariants` из `Acl.svelte` снимается, когда потребители этапа 3 перейдут на `surfaceVariants`.

---

## Решения, которые ещё действуют

1. В `controls` — только навигация и контекст (`Редактировать`, `Настройки`, `Блокировки`, `Фильтры`, сброс ключа сейфа). Кнопки отправки форм остаются под полями, внутри `render`.
2. У `UserPicker` шаги идут в `controls.start`, `Сбросить выбор` / `Отмена` / `Применить` — в `controls.end`.
3. Удаление сервера — построчно в списке, не в `controls` формы.
4. `reset-key` — внешняя кнопка `form="<id>"`, без `confirm_scope`. Поля ввода снаружи формы не работают: `change` до формы не всплывает.
5. `bindCookieVault` и `StorageVaultForm.svelte` удаляются. Сейф остаётся транспортом, не второй формой.

---

## Этап 3. Экраны ядра на `Surface`

Сейчас эти экраны всё ещё собирают карточку через `userSurfaceVariants` из `Acl.svelte`, а не через `<Surface>`:

- `src/content/user/ui/Profile.svelte` — `Редактировать` / `Заполнить профиль`, `Настройки`, `Блокировки (N)` поднять в `controls`; нижний блок `border-t` убрать.
- `BlocksList.svelte`, `SeedUsersList.svelte`, `UserPicker.svelte`.
- `profile-form/ProfileForm.svelte`, `block-form/BlockForm.svelte`, `user-config/UserConfig.svelte`, `seed-form/SeedForm.svelte`.
- `src/content/storage-servers/ui/StorageServersView.svelte` — оболочка на `Surface`; общая форма — этап 4.

Кнопки отправки не поднимать в `controls`. После перевода потребителей убрать временный реэкспорт `userSurfaceVariants`, если на него больше никто не ссылается.

Проверка: `npm run check`, `npm run test:guard`, браузерные `blocks.mjs` и `auth.mjs`, если они есть в дереве. README `src/components/ui/` и `src/content/user/` — в том же коммите, если меняется контракт экрана.

Коммит: `feat(user): экраны ядра на Surface`.

---

## Этап 4. Одна форма серверов хранилища

Факты, на которых решение стоит: поля пула БД и куки-сейфа совпадают (`slot`, `url`, `encryption_key`, `clear_encryption_key`, `storage_mb`, `file_mb`, `allow_split`, `read_only`); `priority` есть только у пула. Экшен сейфа уже возвращает `snapshot`, клиент держит его в `$state`. Общим должно стать определение формы, а сейф — транспортом, как `AuthWidget` → серверный экшен → запечатанная кука и RAM-снимок.

1. `src/hooks/storage-server-form/` (слой хуков, доступен и `#content/*`, и `#hooks/cookie-vault`):
   - `fields.ts` — `storageServerFields({ withPriority, allowEditExisting })`;
   - `parse.ts` — `parseStorageServerEntry`, `maskStorageServerEntry` (схемы `s3://` / `webdav://` через `#lib/storage`);
   - `form.ts` — `defineStorageServerForm({ id, withPriority })` с действиями `save`, `delete` (`validate: 'none'`), `reset-key` (`validate: 'none'`);
   - `README.md` обязателен.
2. `src/components/storage-servers/StorageServerForm.svelte`: `Surface` + поля + отправка внутри `render`. Пропы: `form`, `withPriority`, `submitLabel`, `editId`, `onSaved`, `formId`.
3. Идентификаторы разные (`storage-server-admin`, `storage-server-vault`): реестр форм падает на одинаковом `id`. Определение одно.
4. `StorageServersView.svelte` остаётся тонким адаптером; построчные `delete:<id>` сохраняются.
5. `defineCookieVault` оставляет `scope`, `maxEntries`, `form`, `parse`, `mask`. `bind.svelte.ts` и `resetKeyForm` удаляются. `CookieVault.svelte` остаётся списком и рисует `StorageServerForm`. Кнопка сброса — `<Button form={formId} {...bound.intent('reset-key')}>`, без своего `<Form>` и без `confirm_scope`.
6. Сервер и RAM не переписывать: `saveVaultEntry` / `removeVaultEntry` / `resetVaultKey` по-прежнему пишут `HttpOnly`-куки и возвращают `snapshot`.

`priority` и `clear_encryption_key` — только в режиме БД. В сейфе слот перезаписывается по имени.

Проверка: чистое ядро и дерево с `MODULES=demo`. Тег `modules` не публиковать без отдельной команды.

Коммит: `feat(storage): единая форма серверов хранилища для пула и куки-сейфа`.
