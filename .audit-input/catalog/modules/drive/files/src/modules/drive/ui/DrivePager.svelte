<script lang="ts">
  /** Курсорный пагинатор: вперёд по `drive.after`, назад — в начало списка. */
  import { Button } from '#core/ui/index.js'

  interface Props {
    total: number
    shown: number
    /** Адрес следующей порции; `null` — порция последняя. */
    nextHref: string | null
    /** Адрес первой порции без курсора. */
    firstHref: string
    /** Показан не первый экран (курсор в адресе). */
    paged?: boolean
  }

  let { total, shown, nextHref, firstHref, paged = false }: Props = $props()
</script>

<nav class="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Страницы">
  <span class="text-muted-foreground">
    Показано {shown} из {total}
  </span>
  <div class="flex items-center gap-2">
    {#if paged}
      <Button href={firstHref} variant="ghost" size="sm">В начало</Button>
    {/if}
    {#if nextHref}
      <Button href={nextHref} variant="outline" size="sm">Дальше</Button>
    {/if}
  </div>
</nav>
