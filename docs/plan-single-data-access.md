# План: одна точка доступа к данным списка seed-юзеров

Решение владельца (этот ход): REST в проекте пока не планировался; нужна одна
точка доступа к данным. Роут `GET /api/seed-users` (введён коммитом `f6acfdb`
по прецеденту демо `/api/db-posts`, с владельцем отдельно не согласовывался)
убирается. Единственной точкой остаётся серверный `load` роута `/users`:
страница (SSR), модалка (preloadData по route) и догрузка пагинатора
(preloadData на `/users?users=N`) исполняют один и тот же `load`, а он —
один доменный вызов `listSeedUsers`.

## Приёмка

- [x] `src/routes/api/seed-users/` удалён; `GET /api/seed-users` → 404.
- [x] Догрузка пагинатора: `preloadData('/users?users=N&users.size=S')`,
      отказ `fact` из `load` доходит до пагинатора броском с кодом домена.
- [x] Поведение списка не меняется: SSR первая порция, accumulate, URL `?users`.
- [x] Гейты: svelte-check, layer-guard, vitest (user/paginate/modals), build;
      браузерная проба: страница и модалка, догрузка без `/api/seed-users`
      в сети, 404 на старый адрес.
- [x] README user обновлён в том же коммите; коммит локальный, push — по
      отдельному указанию.

## PROCEDURE

Preview :5173 (production build), Playwright: перехват запросов страницы —
догрузка обязана идти в data-запрос `/users` (`__data.json`), запросов
`/api/seed-users` быть не должно.
