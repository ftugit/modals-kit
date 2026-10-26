# План: страница и модалка профиля на одном `load`

**Задача.** Появился экран чужого/своего профиля по адресу `/user/[id]`: страница и
модалка `user.profile`. Оба носителя берут данные из ОДНОЙ функции `load`; отказ
прав приходит данными и превращается в экран `Acl`, а не в ошибку загрузки.

**Состояние на старте.** Репозиторий `projects/modals-kit`, ветка `img`,
HEAD `b35b9f5`, дерево чистое. Решения зафиксированы в `docs/archive.md`
(разделы «Отказ от прав приходит ДАННЫМИ…» и «Профиль: один экран на страницу и модалку»).

## Решения и причины

| решение | почему |
|---|---|
| `load` возвращает факт, а не бросает | бросок даёт `rt.status='error'`, компонент модалки не монтируется, `Acl` показать некому |
| `ok(null)` = «прав нет» | `policy.select` не отдаёт чужую строку, а не сообщает «запрещено» (`content/user/profile.ts:16-22`) |
| экран один — `ProfileScreen` | ветвление `fact / profile / пусто` пишется один раз на два носителя |
| страница берёт данные из `data`, модалка из `useLoader()` | результат одного и того же `load`; форма данных одна |
| модалка без `loader`, только `route` | `fetcher` сам берёт `preloadData` по `route` (`lib/modals/loader.ts:130-146`) |
| `ProfileForm` не меняется | он уже принимает `subject` + `initial` (`ui/profile-form/ProfileForm.svelte:54-64`) |

## Команды

```sh
export PATH=/tmp/node22/bin:$PATH
node node_modules/.bin/svelte-kit sync
NODE_OPTIONS=--max-old-space-size=1250 node node_modules/.bin/svelte-check \
  --threshold error --tsconfig ./tsconfig.json
node node_modules/vitest/vitest.mjs run src/content/user
node --test tooling/*.test.mjs
```

## Стадии

- [x] **S1. Типизированный маршрут.** `content/user/routes.ts`: `userProfileRoute =
      kitRoute('/user/[id]', { dynamic: true })`. Проверка: `svelte-check` без ошибок.
- [x] **S2. `load`.** `routes/(site)/(app)/user/[id]/+page.server.ts` — `auth(event).profile(id)`
      → `{ uid, profile, fact, limits, enabled }`, `cache-control: private, no-store`.
      Проверка: `svelte-check` (типы `$types` сгенерированы `sync`).
- [x] **S3. Страница.** `routes/(site)/(app)/user/[id]/+page.svelte` — `<ProfileScreen {...data} />`.
- [x] **S4. Экран.** `content/user/ui/ProfileScreen.svelte` — `{#if fact}Acl{:else if profile}ProfileForm{:else}Acl not_found{/if}`.
- [x] **S5. Модалка.** `ui/ProfileModal.svelte` (`useLoader`), `ui/ProfileModalLazy.svelte`,
      регистрация `user.profile` с `route: userProfileRoute.href` в `content/user/modals.ts`.
- [x] **Гейты.** `svelte-kit sync` → `svelte-check` (0 ошибок) → `vitest src/content/user` →
      `node --test tooling/*.test.mjs` (145/0 на старте).

## Критерии приёмки

| # | критерий | проверка |
|---|---|---|
| 1 | один `load` обслуживает страницу и модалку | роут есть в `+page.server.ts`, модалка грузит его через `route` |
| 2 | отказ прав — данные | в `load` нет `error(...)`/`throw` |
| 3 | экран один | `ProfileScreen` — единственное место с ветвлением |
| 4 | модалка без `loader` | в `registerModal` нет поля `loader` |
| 5 | чужой профиль правится через `subject` | `ProfileForm subject={uid} initial={profile}` |

## PROCEDURE

**Пять жёстких правил.**

1. Ни одной правки до версии: правки только в дереве под git, состояние закоммичено (`b35b9f5`).
2. Коммит положен, когда файлы вне `/tmp` изменились и хотя бы один гейт прошёл зелёным —
   триггер наблюдаемый, а не самооценка.
3. Слова «готово / работает / исправлено» без заполненного `<evidence_block>` не употребляются.
4. Невыполнимое требование называется вслух; тихо выброшенное — ложный отчёт.
5. После замечания пользователя: стоп, ответ, ожидание решения — без правок, пока решение не принято.

**VCS.** git есть; ветка `img`; HEAD `b35b9f5`; remote `origin` = `ftugit/modals-kit`; push разрешён.

**Пропущенные требования.** Нет.

## Ход работ

| стадия | результат |
|---|---|
| S1 | `content/user/routes.ts` — `userProfileRoute` (id `/(site)/(app)/user/[id]`, имя `/user/[id]`) |
| S2 | `routes/(site)/(app)/user/[id]/+page.server.ts` — `load` → `ProfileScreenData`, `cache-control: private, no-store` |
| S3 | `routes/(site)/(app)/user/[id]/+page.svelte` — `<ProfileScreen {...data} />` |
| S4 | `content/user/ui/ProfileScreen.svelte` — три ветки |
| S5 | `ui/ProfileModal.svelte` + `ui/ProfileModalLazy.svelte` + регистрация `user.profile` (без `loader`) |

Гейты стадии: `svelte-check` 0 ошибок, `vitest src/content/user` 110/110, `node --test tooling/*.test.mjs` 145/0.

## Следующий шаг

Экран готов. Открытие модалки с параметром (`?modal=user.profile&id=…`) — следующим
шагом: кнопка/ссылка в меню пользователя с `asModalLink`. Форма (чтение/правка
чужого профиля через `requiredGrants`) — задача 322, к этому экрану отношения не имеет.
