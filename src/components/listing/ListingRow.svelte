<!--
  Строка списка, которая ведёт куда-то: ссылка с `href` и поведением от хоста.

  Оболочка её НЕ навязывает. `Listing` отдаёт строку хосту сниппетом `row`, и что
  это будет — ссылка, кнопка, картинка или просто контейнер — решает хост. Этот
  компонент только готовый вариант для самого частого случая: строка открывает
  что-то по адресу. Нужен другой элемент — хост рендерит его сам и компонент
  не использует; тогда `data-id`, `data-testid` и `data-selected` — его ответственность.

  Атрибуты ссылки (`href`, attach-хук на клик) целиком приходят пропом `attrs`:
  оболочка и этот компонент про адреса ничего не знают.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cn } from '#components/utils.js'
  import type { LinkAttrs } from '#hooks/links/index.js'

  interface Props {
    /** Атрибуты ссылки: `href`, `title`, attach-хук — всё от хоста. */
    attrs: LinkAttrs
    /** Идентификатор строки: уходит в `data-id`, по нему тесты ищут строку. */
    id: string
    /** `data-testid` строки. Раньше его ставила оболочка, теперь — хост. */
    testId?: string
    /** Строка отмеченной: смысл выбора задаёт хост, оболочка только передаёт. */
    selected?: boolean
    class?: string
    children: Snippet
  }

  let { attrs, id, testId, selected = false, class: className, children }: Props = $props()
</script>

<a
  {...attrs}
  class={cn('block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
  data-testid={testId}
  data-id={id}
  data-selected={selected || undefined}
>
  {@render children()}
</a>
