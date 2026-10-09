<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cn } from '../cn'

  interface Props {
    shown: 'first' | 'second'
    first: Snippet
    second: Snippet
    class?: string
  }

  let { shown, first, second, class: cls }: Props = $props()
</script>

<span
  class={cn(
    // Бывший `.affix-swap`: обе смены в одной ячейке сетки; без анимации
    // (`data-anim` не задан) состояние меняется мгновенно, с ней — уезжает
    // по rotate или scale. Переход раньше задавал общий CSS, теперь — утилита
    // на детях через `[&>*]`.
    'grid place-items-center',
    '[&>*]:grid-area-[1/1]',
    '[&>*]:[transition:opacity_200ms_cubic-bezier(0.2,0,0,1),rotate_200ms_cubic-bezier(0.2,0,0,1),scale_200ms_cubic-bezier(0.2,0,0,1)]',
    '[&>*]:motion-reduce:duration-[1ms]',
    '[&>[data-swap=hidden]]:opacity-0',
    '[[data-anim=rotate]_&>[data-swap=hidden]]:rotate-[-90deg]',
    '[[data-anim=rotate]_&>[data-swap=shown]]:rotate-0',
    '[[data-anim=scale]_&>[data-swap=hidden]]:scale-[0.6]',
    '[[data-anim=scale]_&>[data-swap=shown]]:scale-100',
    cls,
  )}
  data-affix-swap=""
>
  <span data-swap={shown === 'first' ? 'shown' : 'hidden'} aria-hidden={shown !== 'first'}>
    {@render first()}
  </span>
  <span data-swap={shown === 'second' ? 'shown' : 'hidden'} aria-hidden={shown !== 'second'}>
    {@render second()}
  </span>
</span>
