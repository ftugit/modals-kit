# Библиотеки кэша с несколькими хранилищами: обзор

Статус: **исследование, ничего не реализовано.** Ход 90. Вопрос владельца: есть ли
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

## 3. Эскиз своего слоя по твоей схеме

### 3.1. Регистрация: сервис, подключение, параметры

```ts
// src/lib/server/cache.ts — единственное место, которое знает про env
import { createCaches, memoryStore } from '#lib/cache/index.js'
import { postgresStore } from '#lib/cache/postgres.js'

export const caches = createCaches([
  [memoryStore({ max: 2000 }), { local: true, atomic: true }],
  ...(DATABASE_URL
    ? [[postgresStore(db), { shared: true, atomic: true, durable: true }] as const]
    : []),
])
```

Параметры описывают **свойства** хранилища, а не его имя:

| Параметр | Значит | memory | Postgres | Upstash | Runtime Cache / KV |
|---|---|---|---|---|---|
| `local` | без сети, наносекунды | ✓ | — | — | — |
| `shared` | видно всем инстансам | — | ✓ | ✓ | ✓ (по региону) |
| `atomic` | есть `add` / `incr` | ✓ (в процессе) | ✓ | ✓ | — |
| `durable` | переживает перезапуск и вытеснение | — | ✓ | ✓ | — |

### 3.2. Место в коде: интерфейс и нужные параметры

```ts
// кэш Shikimori: нужен только get/set, лучше без сети
const pages = caches.cache({ name: 'shikimori:pages', ttl: 60_000, prefer: { local: true } })
await pages.get(url); await pages.set(url, page); await pages.delete(url)

// бронь отправки: обязательно атомарно, по возможности общее для инстансов
const sent = caches.cache({ name: 'form:idempotency', need: { atomic: true }, prefer: { shared: true } })
await sent.add(key, null, 5 * 60_000)   // тип знает про add/incr, потому что need.atomic
```

Правила подбора:

1. `need` — жёсткие условия. Хранилища без них отбрасываются. Если не осталось ни одного,
   ошибка **при создании**, а не на первом запросе (как `addressable` у модалок).
2. `prefer` — мягкие. Из оставшихся берётся хранилище, совпавшее по большему числу
   пожеланий; при равенстве — первое в регистрации.
3. `name` — пространство ключей (`shikimori:pages:<ключ>`) и подпись для логов. Два
   места не перетирают друг другу ключи в одном хранилище.
4. Тип результата зависит от `need`. С `atomic: true` есть `add`/`incr`, без него —
   только `get`/`set`/`delete`. Ошибка видна ещё в редакторе.

Что это даёт. В dev зарегистрирован только memory, и бронь отправки получает memory: атомарно,
не общее (пожелание не выполнено, можно писать предупреждение). На Vercel с
`DATABASE_URL` то же место без единой правки получает Postgres. Кэш Shikimori везде получает
memory, потому что просит `local`.

### 3.3. Что сознательно не входит

- L1/L2 и шина (как BentoCache). По решению хода 88 кэш у нас только в памяти. Если
  понадобится, `prefer` можно расширить до цепочки.
- Grace period и SWR. Сейчас этим занимается `shikimori-schema.ts` (отдаёт прошлую схему
  при сбое). Перенос в слой — отдельный вопрос.

## 4. Вопросы

1. Свой слой по эскизу §3 (зависимостей нет), а unstorage — только как необязательный мост к
   внешним драйверам в будущем. Так?
2. Набор параметров `local` / `shared` / `atomic` / `durable` — хватает? Убрать или добавить
   что-то?
3. Нужно ли делить на `need` (жёстко) и `prefer` (мягко)? Или всё жёстко, и тогда в dev для
   брони придётся явно регистрировать memory как `shared` (это ложь) или ослаблять требование?
4. Если пожелание `prefer` не выполнено: молча, предупреждение в лог в DEV или всегда?
5. Имя: `#lib/cache` или `#lib/store`? Слой обслуживает не только кэш, но и брони.

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
