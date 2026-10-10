<script lang="ts">
  /**
   * Строка записи демо-БД — ОДНА на оба демо: `/db-demo` и пункт «БД» в
   * демо-пагинаторе рисуют её этим же компонентом.
   *
   * Поля общие (title, created_at, id), различаются только то, что об id нужно
   * знать читателю, и оформление контейнера:
   *   • `full` — id целиком и метка `row-id` (на `/db-demo` его копируют в форму
   *     удаления; в компактном списке достаточно префикс-метки);
   *   • `testid` — кем строка опознаётся извне (демо-пагинатор передаёт свой
   *     `catalogTestId`, и пробы ищут строку тем же именем, что и товар с фото);
   *   • `class` — список делит строки линейкой, демо рисует карточку.
   *
   * Держать две версии одной строки — значит однажды обнаружить, что «тот же
   * источник» показывает разные данные: здесь разметка следует за источником, а
   * не наоборот.
   */
  import type { DbPost } from './definition'

  interface Props {
    item: DbPost
    /** Полный id + метка `row-id` (копируют в форму удаления). */
    full?: boolean
    /** Значение `data-testid`; по умолчанию — общая метка `row`. */
    testid?: string
    class?: string
  }

  let {
    item,
    full = false,
    testid,
    class: host = 'flex items-baseline gap-3 px-4 py-2',
  }: Props = $props()
</script>

<div class={host} data-testid={testid ?? 'row'} data-id={item.id}>
  <span class="min-w-0 flex-1 truncate">{item.title}</span>
  <span class="text-xs text-muted-foreground">{item.created_at}</span>
  <code class="text-xs text-muted-foreground" data-testid={full ? 'row-id' : undefined}>
    {full ? item.id : item.id.slice(0, 8)}
  </code>
</div>
