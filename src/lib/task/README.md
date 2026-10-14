# `#lib/task` — состояние задачи («лоадер»)

Один формат состояния для всего, что показывает ожидание: ссылки, кнопки, триггеры модалок,
полоска сверху. Модуль чистый: тип и арифметика, без фреймворка и DOM.

## Слои

| Слой | Что делает | Пример |
|---|---|---|
| Ядро библиотеки | говорит **своими** словами; `#lib/task` не импортирует | `PaginatorState.status: 'loading'`, `RuntimeStatus` модалок |
| Адаптер к фреймворку | переводит слова ядра в `TaskState` | `linkTask(href)` в `#lib/router/sveltekit.js` |
| UI | читает только `TaskState` | `asLink(href, { task })` (`#lib/components/links`) |

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

`asLink` (`#lib/components/links`) кладёт поведение на обычную `<a href>` или `Button`
(без JavaScript это просто ссылка). С JavaScript ссылка сама узнаёт, что переход SvelteKit идёт
на её адрес (`linkTask`), и через 150 мс пишет `data-state="loading"`; процент, если он есть, —
в `data-task-percent`; ошибку — `data-state="error"` и причину в `title`. Рисует это одно
правило CSS: спиннер, число рядом с ним, знак «!». Короткие переходы и записи адреса модалками
не мигают. Битая ссылка (адреса нет среди страниц) — ошибка: «!» и причина.

```svelte
<a {...asLink('/export', { task: () => exportTask })}>Экспорт</a>
```

## Что ещё не сделано

Ход 138 — только то, что нужно ссылкам (`asLink`). Полоска сверху, глобальный лоадер, адаптеры
пагинатора, форм, модалок, поиска и строки состояния в ответах сервера — по плану
`docs/design/task-state.md`, отдельным решением владельца.
