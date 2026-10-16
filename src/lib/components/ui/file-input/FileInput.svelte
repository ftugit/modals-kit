<script lang="ts">
  // Выбор файла. Своё значение у поля одно — выбранные файлы; задать его разметкой
  // нельзя (браузер запрещает писать `value` у type="file"), поэтому `value` сюда
  // не принимается: страница, вернувшаяся с ошибкой, просит выбрать файл заново.
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { cn } from '../../../utils'
  import { inputVariants } from '../field/field'

  interface Props extends Omit<HTMLInputAttributes, 'size' | 'type' | 'value'> {
    size?: 'sm' | 'md' | 'lg'
  }

  let { size, class: cls, ...rest }: Props = $props()
</script>

<input
  type="file"
  class={inputVariants({
    size,
    class: cn(
      'h-auto py-1.5 file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-sm file:text-foreground',
      cls,
    ),
  })}
  {...rest}
/>
