# Ссылки приложения: `asLink`, `asModalLink`

Не компоненты, а **атрибуты на ваш собственный элемент**. Вид даёт сам элемент:
голая `<a>` со своими классами или примитив `Button`. Второго источника дизайна нет.

```svelte
<script lang="ts">
  import { asLink, useModalLink } from '#hooks/links/index.js'
  import { Button } from '#components/ui/index.js'

  const asModalLink = useModalLink() // область ModalHost — из контекста, поэтому в <script>
</script>

<a {...asLink('/paginator')} class="underline">Пагинатор</a>
<Button {...asLink('/form')} variant="outline">Формы</Button>
<Button {...asModalLink('card', { id: 7 })} variant="outline">Карточка</Button>
```

`Button` с ключом `href` рисует `<a>` с тем же видом, поэтому ссылка в облике кнопки
без JavaScript остаётся ссылкой.

## Без JavaScript

| Что | Разметка |
|---|---|
| `asLink('/x')` | `<a href="/x">` — обычная ссылка |
| `asLink('/нет-такой')` | `<a>` без `href`, `aria-disabled`, «!», `title` «Страницы /нет-такой не существует» |
| `asModalLink` модалки с `route` | `<a href="/cards/7">` — ведёт на страницу модалки |
| `asModalLink` модалки без `route` | `<a>` без `href`, `aria-disabled`, `data-pending`; после гидрации — `href="?modal=…"` |
| `asModalLink` необъявленной модалки или с битым `route` | заблокирована всегда: «!» и причина; на 404 пользователь не попадает |

## Состояние

Атрибуты пишет вложение (`svelte/attachments`) после гидрации:

| Атрибут | Когда |
|---|---|
| `data-state="loading"`, `aria-busy="true"` | идёт переход на этот адрес или загрузчик модалки — через 150 мс (`TASK_DELAY_MS` из `components/loader`) |
| `data-task-percent` | у задачи есть честный процент (`task` из `#lib/task`) |
| `data-state="error"` + `title` | битая ссылка, ошибка загрузчика при `navigateOnError: false`, ошибка загрузчика модалки |
| `data-state="open"`, `aria-disabled` | модалка этой ссылки открыта; повторный клик гасится |

Рисует их **одно правило CSS** (`indicator.ts`, подключено preflight'ом в `unocss.config.ts`):
спиннер перед текстом, процент после, знак «!» цветом `--destructive`. Маркеры — `data-link` и
`data-modal-link`; у `Button` (`data-slot="button"`) свой отступ убран, у кнопки есть `gap`.

Свой вид — утилитами по тем же атрибутам. Пример с `/modals` — оверлей на карточке:

```svelte
<a {...asLink('/cards/501')} class="group relative block before:hidden">
  Карточка
  <span class="absolute inset-0 hidden place-items-center group-data-[state=loading]:grid">…</span>
</a>
```

`before:hidden` убирает общий значок: утилиты идут после preflight и перекрывают его.

### Задача на любой кнопке: `taskAttrs`

Тот же вид и та же задержка — у кнопок, которые ведут свою задачу (`#lib/task`).
`Button` делает это пропом `task`; сырой элемент компонента — атрибутами:

```svelte
<Button type="submit" task={formTask(form.state)}>Добавить</Button>
<button {...taskAttrs(action.task)} class="…">Сброс</button>
```

Пока задача `pending` — спиннер через 150 мс, процент, `aria-busy`, задача в
глобальном лоадере; клик гасится сразу. `Button` вдобавок сразу становится
`disabled` (у `<a>` — `aria-disabled`); сырой элемент с `taskAttrs` — нет, его
доступность решает компонент. Маркер — `data-task`.

## Опции

```ts
asLink(href, {
  navigateOnError?: boolean // false — сначала загрузчик; упал — остаёмся, «!» на ссылке
  replace?: boolean         // data-sveltekit-replacestate
  check?: boolean           // false — не сверять с таблицей роутов (эндпоинт +server.ts)
  task?: () => TaskState    // состояние от библиотеки вместо перехода SvelteKit
})

asModalLink(name, params?, {
  href?: string             // свой адрес для перехода без JS
  stack?: 'new' | 'first'   // что сделать со стопкой; href перестраивается так же
  onOpened?: () => void
  ...overrides              // ChainOverrides: size, color, noForward…
})
```

Внешние ссылки и адреса с расширением (`/robots.txt`) с роутами не сверяются.

## Подводные камни

- **Свой `onclick` на элементе срабатывает ПОСЛЕ нашего обработчика**: Svelte делегирует
  `onclick` от корня, а вложение вешает слушатель на сам элемент. Для `asLink` без
  `navigateOnError: false` это неважно: обработчик тогда ничего не делает. С
  `navigateOnError: false` ваш `preventDefault` переход уже не отменит. `asModalLink` клик
  забирает всегда.
- Атрибуты пересчитываются при каждой навигации (адрес) и смене стопки, вложение
  пересоздаётся. Состояние живёт на элементе (`WeakMap`), поэтому не теряется. Загрузка модалки
  отменяется, только когда элемент ушёл из DOM (F29).
- Причину битой ссылки (`title` из spread) перекроет ваш `title`, стоящий после spread.
  Ошибку, возникшую после гидрации, вложение ставит поверх любого `title` и снимает потом.
- `useModalLink()` вызывается в `<script>` компонента, а не в разметке: ему нужен
  `getContext`.
