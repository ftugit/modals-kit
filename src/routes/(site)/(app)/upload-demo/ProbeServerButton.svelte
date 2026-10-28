<script lang="ts">
  import { untrack } from 'svelte'
  import Field from '#components/form/Field.svelte'
  import { forms } from '#components/form/forms.config.js'
  import { Button } from '#components/ui/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import {
    probeServerFormFor,
    type StorageProbeResult,
    type StorageReport,
  } from './forms.js'

  let {
    serverName,
    onProbed,
  }: {
    serverName: string
    onProbed?: (probe: StorageProbeResult, report?: StorageReport) => void
  } = $props()

  const initialName = untrack(() => serverName)
  let result = $state<StorageProbeResult | null>(null)

  const form = bindComponentForm(forms, probeServerFormFor(initialName), {
    instance: `probe:${initialName}`,
    onSuccess: (res) => {
      const payload = res.data as
        | { probe?: StorageProbeResult; storageReport?: StorageReport }
        | undefined
      if (payload?.probe) {
        result = payload.probe
        onProbed?.(payload.probe, payload.storageReport)
      }
    },
  })
</script>

<div class="space-y-1.5 pt-1">
  <Form {form} hiddenFields={form.hidden()} class="inline-flex">
    <Field of={form.f.server_name} />
    <Button
      type="submit"
      variant="outline"
      size="sm"
      task={formTask(form.state)}
      data-testid={`probe-btn-${serverName}`}
    >
      Проверить сервер
    </Button>
  </Form>

  {#if result}
    <div
      class={`rounded border px-2 py-1.5 font-mono text-[11px] ${
        result.ok
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'border-destructive/40 bg-destructive/10 text-destructive'
      }`}
      data-testid={`probe-result-${serverName}`}
      data-probe-ok={result.ok ? 'true' : 'false'}
    >
      <div>
        {result.ok ? 'OK' : 'ОШИБКА'} ({result.totalMs} мс):
        {result.steps.map((s) => `${s.step}:${s.ok ? 'ok' : 'err'}`).join(' → ')}
      </div>
      {#if result.error}
        <div class="mt-0.5 break-all">{result.error}</div>
      {/if}
    </div>
  {/if}
</div>
