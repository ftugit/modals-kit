<script lang="ts">
  // Те же соображения, что и у TextField: классы берёт сам примитив Textarea,
  // управляемое значение — нет.
  import type { FieldView } from '#core/lib/form/svelte/index.js'
  import { Textarea } from '#core/ui/index.js'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()
</script>

<FieldShell {f}>
  <Textarea
    {...f.attrs}
    rows={3}
    value={String(f.value ?? '')}
    onblur={() => f.setTouched()}
    oninput={(e) => f.onInput(e.currentTarget.value)}
  />
</FieldShell>
