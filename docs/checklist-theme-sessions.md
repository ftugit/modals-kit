# Чеклист: тема, свои сессии, скелетон клика

Хендофф для другого агента. Код уже в рабочем дереве; этот файл фиксирует, что проверено и что нет.

## Задача

1. Кнопка темы рядом с профилем.
2. Кнопка «Сессии» находится у вошедшего пользователя.
3. Клик не открывает модалку со скелетоном раньше данных и чанка. Медленный адрес `?modal=…&slow=true` по-прежнему показывает `[data-modal-skeleton]`.
4. Обычный пользователь видит свои сессии и может их заблокировать.
5. Промт `coding-agent-prompt.md`: среда, Playwright, чеклист, локальный коммит, evidence. Без push.

## Состояние репозитория и среды

- Дерево: `/home/user/repos/modals-kit-update`, ветка `img`.
- Git есть. `.git/config` в снимке песочницы не было; локально восстановлен identity `Arena Agent <arena-agent@local>` и `origin` = `https://github.com/ftugit/modals-kit` (URL из `.git/FETCH_HEAD`). Push не делался.
- Неотслеживаемые чужие каталоги (`src/routes/(site)/(app)/db-demo`, `test/browser/*`, `src/server/storage.server.ts` и др.) в коммит этой работы не входят.
- ОС: Linux x86_64. Диск `/` ext4, 25G. `/tmp` — tmpfs 992M, эфемерный. `/home/user` на том же ext4, переживает сообщения. `node_modules`, `.svelte-kit`, `.cache` в снимок не входят.
- Системный Node 20.20.2. Проект требует `>=22.17 <25`. Для проверок скачан `/tmp/node-v22.23.4-linux-x64` (tmpfs, пропадёт).
- Память: 1982 MB, swap нет. `vite` + Chromium получили SIGKILL 137.

## Решения

- Владелец уже учитывался в `sessions.server.ts` (`458aea2`) и `SESSION_ACL` (`owner.auth_id`: read/update/softDelete). Менять модель не нужно.
- Сырой `<form>` запрещён layer-guard. Отзыв — `Form` + `bind(..., { intercept: false })` и `createFormHandler` в экшенах `?/revoke` и `?/others`.
- Кнопка «Сессии» в шапке (`header-sessions-open`) только при `vault.authorized`. Гость её не видит.
- Клик `asModalLink` ждёт `preloadModal` (данные и вид), потом открывает. Скелетон остаётся для уже открытой оболочки с медленным загрузчиком (адрес).

## Команды

```
PATH="/tmp/node-v22.23.4-linux-x64/bin:$PATH"
KIT_ADAPTER=node
PLAYWRIGHT_BROWSERS_PATH=/tmp/ms-playwright
```

## Критерии

| Критерий | Статус | Доказательство |
| --- | --- | --- |
| Тема слева от профиля | pass | `+layout.svelte` offset 888/999; браузер: тема x=976, «Авторизация» x=1014 |
| «Сессии» у вошедшего | pass в SSR/коде; браузер вошедшего unverified | кнопки в шапке, меню, профиле, настройках; гость в браузере кнопки не видит |
| Клик без скелетона | pass по юниту | `loader.test.ts` «тёплый кеш данных всё равно ждёт вид»; `modal-link` ждёт preload |
| Медленный адрес со скелетоном | unverified в этом прогоне | код `ModalHost`/`ModalContent` не вырезан; `test/browser/modals.mjs` не запускался |
| Свои сессии и блокировка | pass по SSR и сборке | `SessionsView.ssr.test.ts`; маршрут в билде; живой список unverified: без `AUTH_SEAL_SECRET` страница отдаёт `auth_disabled` |
| Локальный коммит без push | pass после коммита, который содержит этот файл | `git log` |

## Сделано

- Тема: `top.end` offset 888, профиль 999, `ml-1` снят.
- Сессии: маршрут, модалка, список, форма отзыва, кнопки.
- Скелетон клика: preload до `open()`.

## Не сделано / сбои

- `npm run test:guard`: 170 pass, 21 skip, 1 fail. Падение — `tooling/source-schema-guard.test.mjs` «в проекте нет нарушений границы…», ключи `filters.value` в чужих файлах (`shikimori`, `seed-users/filters-form.ts`). Не из этого диффа. Не чинилось.
- Полный `vitest run` не запускался: 2 GB RAM, совместный vite+Chromium уже убит.
- `svelte-check` в этом ходе не запускался: прошлый прогон умер на ~924 MB.
- `playwright install chromium`: Chrome скачался, headless shell — ENOSPC на tmpfs. Проверка браузера пошла бинарём `chrome` с `--no-sandbox`.
- Браузерный вход под пользователем не проверялся: на стенде вход выключен (`ACL auth_disabled`).

## Следующий шаг

Нет открытого шага этой задачи. Если понадобится живой список: задать `AUTH_SEAL_SECRET`, войти и открыть «Сессии». Чужой fail `test:guard` не смешивать с этим коммитом.

## PROCEDURE

Пять hard_rules промта:

1. No edit before version control. If the target tree has no VCS, create it and commit the state before the first change. "Commit later" never arrives.
2. A commit is due when files outside `/tmp` changed and at least one gate was run green — not "when I consider the stage finished".
3. The words "done", "works", "fixed" may not appear without the evidence_block filled in.
4. A requirement that cannot be met is stated out loud. A silently dropped requirement is a false report.
5. After any user correction: stop, answer the question, wait for the decision. No edits while a decision is pending.

VCS: репозиторий есть, ветка `img`. Последний коммит до этой работы: `5211237` `refactor(db): сброс сборки читает только DATABASE_URL`. Коммит этой работы — тот, в котором лежит этот файл.

Пропущенные требования промта:

- Чеклист создан после кода, не до первой правки: промт применён задним числом.
- Полный набор lint/typecheck/все тесты/весь браузерный прогон не зелёный. Причины выше.
- Playwright capability check выполнен (data URL, текст `sessions-ok`). Полный `test/browser/modals.mjs` — нет.
