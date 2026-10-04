<script lang="ts">
  // Те же соображения, что и у TextField: классы берём, управляемое значение — нет.
  import type { FieldView } from '$lib/form/svelte'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()

  const cls =
    'w-full min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm ' +
    'text-foreground shadow-xs placeholder:text-muted-foreground transition-colors outline-none ' +
    'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 ' +
    'aria-invalid:border-destructive aria-invalid:ring-destructive/20'
</script>

<FieldShell {f}>
  <textarea
    {...f.attrs}
    class={cls}
    rows="3"
    onblur={() => f.setTouched()}
    oninput={(e) => f.onInput(e.currentTarget.value)}
  >{String(f.value ?? '')}</textarea>
</FieldShell>
