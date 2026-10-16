<script lang="ts">
  /**
   * Поля сохранённого набора в форме записи — разметка приложения: цикл и обёртку
   * пишет страница, библиотека отдаёт поля схемы по порядку (`form.from()`).
   */
  import type { BoundForm } from '#lib/form/svelte/index.js'
  import Field from '#lib/components/form/Field.svelte'

  let { form }: { form: BoundForm } = $props()
</script>

{#each form.from() as { item, f } (f.name)}
  <div data-preset={item.preset}>
    <Field of={f} />
  </div>
{/each}
