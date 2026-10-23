<script lang="ts">
  // Свой виджет — такой же гражданин, как встроенные: принимает то же
  // представление поля. Ни одного обращения к движку напрямую.
  //
  // Ползунок — `Range` из `ui/`: нативный `<input type="range">` работает и с JS,
  // и без JS, но визуально рендерится как shadcn Slider (трек + заполнение + кружок).
  import { Range } from '#lib/components/ui/index.js'
  import type { FieldView } from '#lib/form/svelte/index.js'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()
</script>

<FieldShell {f}>
  <div class="flex items-center gap-3">
    <Range
      {...f.attrs}
      value={String(f.value ?? '')}
      wrapperClass="flex-1"
      onchange={(e) => f.onInput(e.currentTarget.value)}
      oninput={(e) => f.onInput(e.currentTarget.value)}
    />
    <output class="w-6 text-center text-sm tabular-nums">{f.value}</output>
  </div>
</FieldShell>
