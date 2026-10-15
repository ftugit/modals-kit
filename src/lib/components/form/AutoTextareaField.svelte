<script lang="ts">
  // Компонент приложения для `field.textarea({ variant: 'auto' })`: высота растёт
  // по тексту от трёх до восьми строк (примитив AutoTextarea). Без JS и в браузерах
  // без `field-sizing` поле остаётся обычным многострочным — значение то же.
  import type { FieldView } from '#lib/form/svelte/index.js'
  import { AutoTextarea } from '#lib/components/ui/index.js'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()
</script>

<FieldShell {f}>
  <AutoTextarea
    {...f.attrs}
    minLines={3}
    maxLines={8}
    value={String(f.value ?? '')}
    onblur={() => f.setTouched()}
    oninput={(e) => f.onInput(e.currentTarget.value)}
  />
</FieldShell>
