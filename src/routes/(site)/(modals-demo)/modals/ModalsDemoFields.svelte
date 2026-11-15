<script lang="ts">
  /**
   * Своя разметка панели настроек модалок (`ui` универсальной `DemoPanel`):
   * восемь списков в две колонки и ползунок хвостов. Раскладка — страницы;
   * адрес, форма и решения схемы (выключение, подсказки) — панели.
   *
   * Второй живой пример `ui` (первый — `steps/StepsDemoFields.svelte`).
   */
  import type { DemoUiProps } from '#components/demo/index.js'
  import { Field, Select } from '#components/settings/index.js'
  import { Input } from '#components/ui/index.js'
  import { MODALS_SELECTS } from './demo-schema.ts'

  let { field }: DemoUiProps = $props()

  const tail = $derived(field('tail_count'))
</script>

<div class="grid gap-4 sm:grid-cols-2">
  {#each MODALS_SELECTS as name (name)}
    {@const f = field(name)}
    <Field label={f.v.label ?? name} hint={f.hint} hintId={`${f.v.attrs.id}-help`}>
      <Select
        {...f.v.attrs}
        name={f.v.name}
        value={f.v.value === undefined || f.v.value === null ? '' : String(f.v.value)}
        disabled={f.disabled}
        options={f.options}
      />
      {#each f.v.errors as error (error.id)}
        <p class="mt-0.5 text-xs text-destructive" {...f.v.errorProps()}>
          {error.message ?? error.code}
        </p>
      {/each}
    </Field>
  {/each}
  <Field
    label={`${tail.v.label ?? 'Число хвостов'}: ${String(tail.v.value ?? '')}`}
    hint={tail.hint}
    hintId={`${tail.v.attrs.id}-help`}
  >
    <Input
      {...tail.v.attrs}
      type="range"
      min="0"
      max="6"
      class="w-full accent-primary"
      name={tail.v.name}
      value={tail.v.value === undefined || tail.v.value === null ? '' : String(tail.v.value)}
      disabled={tail.disabled}
      oninput={(e) => tail.v.onInput?.(e.currentTarget.value)}
    />
  </Field>
</div>
