# `#lib/auth` — каркас API пользователя (seed-вход, отзыв токенов)

Статус: **каркас без реализации** (ход 251). Тела функций пустые — оценивается цепочка
вызова и покрытие правил статьи об отзыве JWT; правила реализации и источники —
`docs/design/auth-seed.md`. В routes не импортируется: подключение — gateway,
его включит `hooks.server.ts` при внедрении.

## Модуль, не библиотека

Папка в `src/content/` — модуль ПРИЛОЖЕНИЯ (как `posts.ts`, `shikimori-filters.ts`):
принадлежит домену «пользователь», а не переиспользуемому слою. Внутри одна папка
держит всё, что про юзера: БД-схему, поля форм, API, ошибки, gateway.

## Состав

| Файл | Что |
|---|---|
| `schema.ts` | ресурс `lib/db` (identity) И поля формы — из одного объявления (прецедент `posts.ts`) |
| `error.ts` | коды доменных ошибок + проводка в `lib/form` + таблица статусов для REST |
| `types.ts` | клеймы токена, сессия, principal, ответы API |
| `ports.ts` | порты: challenge/сессии/чёрный список/identity/ключи/токен/подпись/куки/время/сеть/настройки |
| `user.ts` | голые функции API (auth + профиль); правила статьи помечены «статья: N» |
| `gateway.svelte.ts` | подключение приложения: порты из хвостов, фасад `auth(event)`, principal для `dbHandle` |
| `index.ts` | единый экспорт модуля |

## Цепочка вызова (REST и POST одновременно)

```
POST /api/auth/login (+server.ts)   ─┐
                                      ├─> auth(event).login(args) ─> api.login(ports, args)
экшен ?/login (+page.server.ts)     ─┘

любой запрос: hooks.server.ts ─> auth(event).verify() ─> api.verify(ports)
                                └─> principalOf(result) ─> dbHandle({ principal })
                                    (замена DEMO_PRINCIPAL; гость — undefined)
```

Ядро не знает Request/Response/cookies: голые аргументы → голый `AuthResult` с кодом.
Куки-носитель и HTTP-перевод — адаптер.

## Покрытие статьи об отзыве JWT

| Правило статьи | Где в ядре |
|---|---|
| 1. чёрный список `jti` | `verify` (проверка), `revokeSession` (гранулярно), `logout` (свой `jti`) |
| 2. короткий exp | `ACCESS_TTL_SEC` = 15 мин; повторная проверка `exp` в `verify` |
| 3. ротация секрета | `rotateSigningKey` + `keys.secretOf(kid)`: старые принимаются, новый пишет |
| 4. версионирование | `ver` в клеймах против `tokenVersion`; `logoutEverywhere` = инкремент |
| 5. выход и инвалидация | `logout`: бронь удалена + `jti` в чёрный список до конца exp |
| 6. TRL | `revocationSnapshot`: стык для будущих сервисов; свой сервис не выделяем |
| 7. refresh | `renew`: новый `jti`, старый гасится сразу (без второго токена и окна уязвимости) |
| HttpOnly/Secure куки | `COOKIE_NAME` + `CookiePort`: токен не в теле ответа и не в localStorage |
| мониторинг аномалий | `noteActivity`: счётчик хешей подсетей, IP не хранится |
| автоматизация | порты вместо ручного менеджмента ключей; ротация `kid` — как у курсорных |

## Приватность (§4 плана)

identity — строка-псевдоним (pubkey, createdAt, tokenVersion); ни email, ни IP, ни
аналитических кук; `deleteIdentity` исполняет право на удаление целиком.

## Порядок внедрения

Шаги 1–8 — `docs/design/auth-seed.md` §5. Первым связывается `verify` в `hooks.server.ts`
(principal из сессии), затем вход, затем списки сессий и ротация.
