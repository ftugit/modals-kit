<script lang="ts">
  // Фикстура тестов Field.takeover: заменяющий компонент перехватчика.
  // Значение и ошибку операции пишет через живую ручку `f` (проп).
  import Input from '#lib/components/ui/input/Input.svelte'
  import type { FieldHandle } from '#lib/form/svelte/index.js'
  import FieldShell from './FieldShell.svelte'

  let { f }: { f: FieldHandle } = $props()
</script>

<div data-taken>
  <FieldShell {f}>
    <Input
      {...f.attrs}
      value={String(f.value ?? '')}
      onblur={() => f.setTouched()}
      oninput={(e) => {
        f.onInput(e.currentTarget.value)
        f.error = e.currentTarget.value === 'bad' ? { code: 'doc.unprepared' } : undefined
      }}
    />
  </FieldShell>
  <span data-live>{String(f.value ?? '')}</span>
</div>
