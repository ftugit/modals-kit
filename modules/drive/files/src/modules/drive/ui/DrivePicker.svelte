<script lang="ts">
  /**
   * Пикер файлов: тот же список диска, но строка возвращает id вызывающему
   * экрану, а не открывает карточку.
   *
   * Контракт адреса: `from` (локальный адрес возврата), `param` (какой
   * query-параметр заполнить), `kind` (`folder` — только папки), `folder`
   * (текущая папка пикера).
   */
  import type { DrivePickerData } from '../types.js'
  import DriveBrowse from './DriveBrowse.svelte'

  interface Props {
    initial: DrivePickerData
  }

  let { initial }: Props = $props()

  const picker = $derived({
    from: initial.from,
    param: initial.param,
    kind: initial.kind,
    folderId: initial.folderId,
  })
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <DriveBrowse initial={initial.list} variant="plain" url={false} {picker} />
</div>
