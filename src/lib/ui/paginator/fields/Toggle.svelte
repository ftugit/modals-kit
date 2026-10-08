<script lang="ts">
  import { Switch } from '$lib/ui/primitives'

  interface Props {
    name?: string
    label: string
    checked: boolean
    onChange?: (v: boolean) => void
    disabled?: boolean
    /** ПОЧЕМУ переключатель выключен (возможности источника), см. `Field`. */
    hint?: string
    /**
     * Пара hidden-вход + чекбокс для нативного GET (значение «false» доезжает
     * до адреса). В url-режиме механизма (`bind`) пару снимаем: набор читает
     * `FormData`, hidden «false» впереди чекбокса и отравил бы декод, а
     * выключенное поле механизму не нужен и так (скип disabled в коммите).
     */
    hiddenPair?: boolean
  }

  let {
    name,
    label,
    checked = $bindable(false),
    onChange,
    disabled = false,
    hint,
    hiddenPair = true,
  }: Props = $props()

  function handleChange(e: Event & { currentTarget: HTMLInputElement }) {
    const next = e.currentTarget.checked
    checked = next
    onChange?.(next)
  }
</script>

<label class="flex items-center gap-2 self-end pb-1.5 text-xs" title={hint}>
  {#if name && disabled && hiddenPair}
    <!-- Сохранить URL-параметр, пока управление отключено возможностями/JS. -->
    <input type="hidden" {name} value={checked ? 'true' : 'false'} />
    <Switch {name} value="true" size="sm" bind:checked {disabled} onchange={handleChange} />
  {:else if name && hiddenPair}
    <input type="hidden" {name} value="false" />
    <Switch {name} value="true" size="sm" bind:checked {disabled} onchange={handleChange} />
  {:else if name}
    <Switch {name} value="true" size="sm" bind:checked {disabled} onchange={handleChange} />
  {:else}
    <Switch value="true" size="sm" bind:checked {disabled} onchange={handleChange} />
  {/if}
  <span class={disabled ? 'text-muted-foreground' : ''}
    >{label}{#if hint}<span class="ml-1 text-muted-foreground/80" data-field-hint>{hint}</span>{/if}</span
  >
</label>
