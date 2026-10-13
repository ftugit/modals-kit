# Библиотеки кэша с несколькими хранилищами: обзор

Статус: **исследование, ход 90; решение и реализация — §3 (ход 93).** Вопрос владельца: есть ли
библиотека, где регистрируются сервисы с их параметрами, а место в коде просит кэш с нужными
параметрами и получает подходящий:

```
Регистрация({ [сервис => (подключение), параметры], [memory => (подключение), параметры] })
const { get, set, delete } = Кэш(интерфейс, нужные_параметры)
```

## 1. Итог

**Готового подбора хранилища «по параметрам» нет ни в одной из найденных библиотек.** Все
они выбирают хранилище иначе:

| Библиотека | Как выбирается хранилище | Атомарные `add`/`incr` | Рантаймы | Замечания |
|---|---|---|---|---|
| **unstorage** (UnJS) | по **префиксу ключа** (mount) или один драйвер на экземпляр | нет | Node, браузер, Workers, Deno | ядро без зависимостей. Драйвер **объявляет** возможности полем `flags` (`{ maxDepth, ttl }`), но подбора по ним нет. Есть драйверы `memory`, `lru-cache`, `upstash`, `redis`, `cloudflare-kv-binding`, `cloudflare-cache-binding`, `vercel-runtime-cache`, `db0` (Postgres/SQLite), `overlay` ([1](https://unstorage.unjs.io/drivers), [2](https://unstorage.unjs.io/guide/custom-driver)) |
| **BentoCache** | по **имени** (`stores: { myCache, multitier }`, `bento.use(name)`), уровни L1/L2 + шина | нет в API (блокировки только внутри, от «stampede») | Node.js ([3](https://bentocache.dev/docs/introduction)) | самая полная *кэширующая* логика: grace period, таймауты, SWR, теги, защита от stampede, синхронизация L1 через шину ([4](https://bentocache.dev/docs/multi-tier)). Сам автор называет keyv/cache-manager/unstorage «мостами к хранилищам», а не кэшем ([3](https://bentocache.dev/docs/introduction)) |
| **cache-manager** v6/v7 | по **порядку уровней** (`stores: [memory, redis]`) | нет | Node | работает поверх Keyv-адаптеров ([5](https://cacheable.org/docs/cache-manager/)) |
| **Keyv** | один адаптер на экземпляр | нет | Node | адаптеры Redis, Postgres, SQLite и др. ([6](https://www.npmjs.com/package/keyv)) |

**Важно про Keyv/cacheable/cache-manager.** 4 августа 2026 эти пакеты пострадали от атаки
на цепочку поставок. Аккаунт мейнтейнера был взломан, вредоносные версии `keyv@6.0.0`,
`cache-manager@7.2.10`, `cacheable@2.5.1` и др. вышли через их собственный CI с валидным
provenance. Червь разошёлся по сотням пакетов
([7](https://www.wiz.io/blog/keyv-and-cacheable-npm-supply-chain-attack),
[8](https://www.endorlabs.com/learn/npm-malware-compromises-keyv-and-cacheable-with-500m-weekly-downloads-and-spreads-to-hundreds-of-packages)).
`cache-manager@7.2.10` попадал под обычный диапазон `^7.2.9` как патч-версия
([9](https://cycode.com/blog/keyv-cacheable-npm-worm-ai-coding-agents/)). Это не приговор
библиотеке, но довод против зависимости там, где своё решение укладывается в сотню строк.

## 2. Что из этого брать

- **Подбор по параметрам** придётся писать самим. Это и есть ядро твоей идеи, и его нет нигде.
- **Объявление возможностей драйвером** уже есть в unstorage (`flags`). Значит, идея
  «хранилище сообщает, что умеет» соответствует практике, а не выдумана.
- **Драйверы unstorage** можно переиспользовать позже: наш адаптер `fromUnstorage(driver,
  traits)` даст Upstash, KV, Runtime Cache и Postgres через `db0` без своего кода. Ядро
  unstorage без зависимостей, драйверы грузят свои библиотеки лениво
  ([1](https://unstorage.unjs.io/drivers)). Атомарных операций у unstorage нет, так что для
  координации (бронь отправки) он не подходит, только для кэша.
- **BentoCache** — ориентир для поведения кэша (grace, stampede, таймауты), но не
  зависимость: заявлен только Node.js, а подбор у него по имени.

## 3. Решение (ходы 91–93)

Подбор хранилища по параметрам (`need`/`prefer`) **отклонён** как лишний. Выбирать
почти не из чего: кэши живут в памяти, общее хранилище нужно одному месту. Подбор
прятал бы, где лежат данные, а явная строка понятнее. Готовых библиотек с подбором
нет, и это скорее довод, что он не нужен. Модалки устроены так же: хранилище
назначает разработчик, флаги (`addressable`) движок только проверяет.

Сделано:

- `#lib/cache` — контракт `Store` (`get`/`set`/`delete`/`clear`/`scope`) и
  `AtomicStore` (+ `add`/`incr`), `memoryStore` с областями и потолками,
  `requireAtomic` для проверки при подключении. README: `src/lib/cache/README.md`.
- `src/lib/server/cache.ts` — `localStore` (память). `sharedStore` (Postgres)
  появится вместе с бронью отправки в транзакции для форм, которые и так пишут в базу.
  Формы без базы получают память: общая бронь сделала бы сервер БД их единственной
  зависимостью (ход 92).
- `storeIdempotency(store)` в lib/form — бронь поверх любого объекта с атомарным `add`.
  lib/form от lib/cache не зависит.

Где подключено и план по остальным местам — README `lib/cache`, §5–6.

## 4. Решено

1. Свой слой без зависимостей. unstorage — возможный мост к внешним драйверам в будущем.
2–4. Параметры и подбор не нужны (см. §3).
5. Имя — `#lib/cache`.

## Источники

1. unstorage, Drivers — https://unstorage.unjs.io/drivers
2. unstorage, Custom Driver (`flags`) — https://unstorage.unjs.io/guide/custom-driver
3. BentoCache, Introduction — https://bentocache.dev/docs/introduction
4. BentoCache, Multi-tier — https://bentocache.dev/docs/multi-tier
5. cache-manager — https://cacheable.org/docs/cache-manager/
6. keyv (npm) — https://www.npmjs.com/package/keyv
7. Wiz: keyv and cacheable hijacked — https://www.wiz.io/blog/keyv-and-cacheable-npm-supply-chain-attack
8. Endor Labs: keyv/cacheable malware — https://www.endorlabs.com/learn/npm-malware-compromises-keyv-and-cacheable-with-500m-weekly-downloads-and-spreads-to-hundreds-of-packages
9. Cycode: semver inversion (`^7.2.9` → 7.2.10) — https://cycode.com/blog/keyv-cacheable-npm-worm-ai-coding-agents/
