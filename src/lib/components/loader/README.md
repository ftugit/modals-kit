# Глобальный лоадер

Одна полоска сверху окна на все задачи сайта. Это UI, а не библиотека:
библиотеки о нём не знают, задачи сюда несут компоненты.

```svelte
<!-- src/routes/+layout.svelte — один раз на всё приложение -->
<LoaderBar />
```

Что попадает в полоску само:

| Источник | Как | Процент |
|---|---|---|
| Переход SvelteKit (ссылка, `goto`, «Назад») | `navigationTask()` из `#lib/address/sveltekit.js` | нет — `load` не сообщает ход |
| Ссылки `asLink` / `asModalLink` | `reflectTask` (`links/state.svelte.ts`) | если задача его знает |
| `Button` с `task` | тот же `reflectTask` | если задача его знает |

Своя задача — `trackTask` внутри эффекта; отписка возвращается сама:

```ts
import { trackTask } from '#lib/components/loader/index.js'

$effect(() => trackTask(() => upload.task)) // upload.task: TaskState из #lib/task
```

Правила показа:

- `scope: 'global'` — полоса сразу;
- `scope: 'local'` — только если задача идёт дольше 150 мс (`TASK_DELAY_MS`):
  короткие переходы и «мелкие» записи адреса (модалки, пагинатор) не мигают;
- процент — у первой задачи, которая знает честный процент; иначе полоса «бежит»;
- `role="progressbar"`, подпись — `taskLabel` задачи, иначе «Загрузка»;
- без JS полоски нет: загрузку показывает браузер.

Проверка в браузере: `test/browser/loader.mjs`.
