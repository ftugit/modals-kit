# Памятка: права моделей `user_auth` и `user_session`

Статус: **в планах** (без разбивки на этапы; сведено вместе с UI активных сессий/устройств в [`docs/plan-sessions.md`](./plan-sessions.md)).

## Суть

- Каталог грантов объявляет `account.read`, `account.edit`, `account.readDeleted`, `session.read`, `session.edit`, но человеческие операции `AuthPorts` пока ходят системным контекстом `SYSTEM` с ручными проверками в домене (кроме уже переведённого `account.readDeleted` через `selectDeleted`).
- При реализации раздела сессий и устройств модели `user.auth.v1` и `user.session.v1` переводятся на нативные политики `defineAcl` (`grants`, `checkGrants`, `useGrants`) по образцу `user_block` и `user_profile`, а `SYSTEM` остаётся только внутренним механизмам без актора-человека (вход/challenge, фаервол `blocksOf`/`guard`, восстановление по `seed`, `sweepDeletions`).
- Полное описание того, что уже есть и что нужно сделать по сессиям и правам, хранится в [`docs/plan-sessions.md`](./plan-sessions.md).
