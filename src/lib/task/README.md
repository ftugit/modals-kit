# `#lib/task` — состояние задачи («лоадер»)

Один формат состояния для всего, что показывает ожидание: ссылки, кнопки, триггеры модалок,
полоска сверху. Модуль чистый: тип и арифметика, без фреймворка и DOM.

## Слои

| Слой | Что делает | Пример |
|---|---|---|
| Ядро библиотеки | говорит **своими** словами; `#lib/task` не импортирует | `PaginatorState.status: 'loading'`, `RuntimeStatus` модалок |
| Адаптер к фреймворку | переводит слова ядра в `TaskState` | `linkTask(href)` в `#lib/address/sveltekit.js` |
| UI | читает только `TaskState` | `asLink(href, { task })` (`#hooks/links`) |

Ядро без адаптера работает как раньше. Формат меняется здесь и в адаптерах, ядра не трогаются.

## Формат

```ts
type TaskState =
  | { status: 'idle' }
  | { status: 'pending'; scope: 'local' | 'global'; label?: string; progress?: TaskProgress }
  | { status: 'error'; message: string }

type TaskProgress =
  | { kind: 'bytes'; loaded: number; total: number }               // честный процент
  | { kind: 'steps'; done: number; total: number; step?: string }  // готовность по этапам
```

- `bytes` — только там, где длина известна заранее (`Content-Length`).
- `steps` — индикатор готовности: «завершено 3 этапа из 10» = 30%. Это не время до конца:
  открытие базы длится секунды, запись сида — миллисекунды, полоска идёт рывками.
- Нет `progress` — бегущий индикатор без числа.
- `scope: 'global'` — общая операция (запуск базы, сборка схемы источника).

## Помощники

```ts
import { IDLE_TASK, taskPercent, taskLabel } from '#lib/task/index.js'

taskPercent({ status: 'pending', scope: 'local', progress: { kind: 'steps', done: 3, total: 10 } }) // 30
taskPercent(IDLE_TASK)                                                                              // null
taskLabel({ status: 'pending', scope: 'global', label: 'Запуск базы',
            progress: { kind: 'steps', done: 1, total: 4, step: 'проверка схемы' } })
// 'Запуск базы — шаг 2 из 4: проверка схемы'
```

## Показ

`asLink` (`#hooks/links`) кладёт поведение на обычную `<a href>` или `Button`
(без JavaScript это просто ссылка). С JavaScript ссылка сама узнаёт, что переход SvelteKit идёт
на её адрес (`linkTask`), и через 150 мс пишет `data-state="loading"`; процент, если он есть, —
в `data-task-percent`; ошибку — `data-state="error"` и причину в `title`. Рисует это одно
правило CSS: спиннер, число рядом с ним, знак «!». Короткие переходы и записи адреса модалками
не мигают. Битая ссылка (адреса нет среди страниц) — ошибка: «!» и причина.

```svelte
<a {...asLink('/export', { task: () => exportTask })}>Экспорт</a>
```

## Кто отдаёт `TaskState`

| Откуда | Адаптер | Где видно |
|---|---|---|
| переход SvelteKit, ссылка | `navigationTask()`, `linkTask(href)` — `#lib/address/sveltekit.js` | ссылка, полоса |
| модалка | `asModalLink` (`#hooks/links`) | ссылка-открывашка, полоса |
| пагинатор | `paginatorTask(state, page?)` — `#lib/paginate/svelte` | ссылка страницы, «Ещё», «Сброс», поиск, полоса |
| форма | `formTask(state, intent?)` — `#lib/form/svelte` | `Button task`, полоса |
| своё | `trackTask(() => task)` — `#components/loader` | полоса |

Полоса сверху — `LoaderBar` (`#components/loader`), один раз в корневом layout.

## Ход сервера: строки ответа

Долгое ожидание на сервере (запуск базы, сборка схемы фильтров, очередь лимита чужого API,
повторы) приходит в ответе на тот же запрос — строками NDJSON, по одной на событие, последняя
строка — сам ответ:

```
{"task":{"status":"pending","scope":"global","label":"Запуск базы","progress":{"kind":"steps","done":1,"total":4,"step":"Проверка схемы"}}}
{"result":{"status":200,"headers":{"content-type":"application/json"},"body":{…}}}
```

- строки идут, только если клиент их попросил (`accept: TASK_STREAM_ACCEPT`) и сервер правда
  ждал; иначе ответ прежний, байт в байт; таймеров нет;
- клиент: `fetchWithTask(url, { onTask })` / `readTaskStream(res, onTask)` из `#lib/fetch` — ход
  в `onTask`, на выходе тот же `Response` с настоящим кодом;
- сервер приложения: `taskResponse(request, run, { watch })` — `src/hooks/task-stream.server.ts`;
- ход доходит до показа через ядра своими словами: `PageRequest.report` → `state.progress`
  пагинатора, `TransportRequest.report` → `FormState.progress` формы; адаптеры
  `paginatorTask`/`formTask` отдают его как задачу.
