<script lang="ts">
  /** Операция «mkdir»: тело формы, общее для страницы и модалки. */
  import type { Result } from '#core/lib/form/index.js'
  import DriveOperationForm from '../DriveOperationForm.svelte'
  import type { DriveOperationData } from '../../types.js'

  interface Props {
    initial: DriveOperationData
    form?: { result?: Result } | null
  }

  let { initial, form = null }: Props = $props()
</script>

<DriveOperationForm op="mkdir" data={initial} {form} />
