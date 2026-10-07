<script lang="ts">
  import { Switch } from '$lib/ui/primitives'

  interface Props {
    name?: string
    label: string
    checked: boolean
    onChange?: (v: boolean) => void
    disabled?: boolean
    /** Почему переключатель недоступен. */
    hint?: string
  }

  let { name, label, checked = $bindable(false), onChange, disabled = false, hint }: Props = $props()

  function handleChange(e: Event & { currentTarget: HTMLInputElement }) {
    const next = e.currentTarget.checked
    checked = next
    onChange?.(next)
  }
</script>

<label class="flex items-center gap-2 self-end pb-1.5 text-xs" title={hint}>
  {#if name && !disabled}
    <input type="hidden" {name} value="false" />
  {/if}
  <Switch
    {name}
    value="true"
    size="sm"
    bind:checked
    {disabled}
    onchange={handleChange}
  />
  <span class={disabled ? 'text-muted-foreground' : ''}
    >{label}{#if hint}<span class="ml-1 text-muted-foreground/80" data-field-hint>{hint}</span>{/if}</span
  >
</label>
