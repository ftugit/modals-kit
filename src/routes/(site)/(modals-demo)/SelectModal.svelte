<script lang="ts">
import { Button } from '#components/ui/index.js'
  import { Select } from '#components/ui/index.js'
  import FloatingMenu from './FloatingMenu.svelte'
  import { useModals } from '#lib/modals/svelte/index.js'
  const genres = [
    { value: 'action', label: 'Боевик' },
    { value: 'drama', label: 'Драма', hint: 'включая мелодраму' },
    { value: 'comedy', label: 'Комедия' },
    { value: 'sci-fi', label: 'Фантастика' },
    { value: 'doc', label: 'Документальный', disabled: true },
  ]
  let picked = $state('drama')
  let many = $state<string[]>([])
  let manyClose = $state<string[]>([])
  let действие = $state('—')
  const m = useModals()
</script>

<div class="flex min-h-0 flex-auto flex-col gap-3.5 overflow-y-auto p-6 text-left [&_h2]:m-0 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_p]:m-0 [&_p]:text-sm [&_p]:text-muted-foreground [&_label]:flex [&_label]:flex-col [&_label]:gap-1.5 [&_label]:text-sm [&_label]:font-medium">
  <h2>Select внутри модалки</h2>
  <p>Список лежит в своём контейнере в <code>body</code>, а частью ловушки фокуса
     модалки его объявляет <code>aria-controls</code> на триггере — штатный
     механизм Zag «follow controlled elements» (решение D31).</p>
  <label>Жанр<Select options={genres} bind:value={picked} placeholder="Выберите жанр" /></label>
  <label>Несколько<Select options={genres} bind:value={many} multiple placeholder="Любые" /></label>
  <label>Несколько, закрывать после выбора<Select options={genres} bind:value={manyClose} multiple closeOnSelect placeholder="Любые" /></label>
  <p class="text-xs" data-select-modal-picked="">Выбрано: {picked} / [{many.join(', ')}] / [{manyClose.join(', ')}]</p>

  <div class="flex flex-wrap items-center gap-3">
    <FloatingMenu
      label="Меню внутри модалки"
      items={[
        { label: 'Дублировать', hint: '⌘D', onSelect: () => (действие = 'дублировать') },
        { label: 'Переименовать', onSelect: () => (действие = 'переименовать') },
        { label: 'Архивировать', hint: 'нельзя', disabled: true },
        { label: 'Удалить', hint: 'необратимо', onSelect: () => (действие = 'удалить') },
      ]}
    />
    <FloatingMenu
      label="Всегда выпадашка"
      sheetOnNarrow={false}
      items={[{ label: 'Этот оверлей не прижимается', hint: 'sheetOnNarrow=false' }]}
    />
    <Button variant="outline"
      onclick={() => m.modals.openLayer({ content: storagelessHere })}
    >
      Без хранилища поверх
    </Button>
    <span class="text-xs">Из меню: <b>{действие}</b></span>
  </div>
  <p>Меню — второй потребитель того же <code>host.floating</code>, что и список:
     Escape, клик мимо и лист на узком экране приходят от хоста.</p>
</div>

{#snippet storagelessHere()}
  <div class="flex flex-col gap-3.5 p-6 text-left [&_h2]:m-0 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_p]:m-0 [&_p]:text-sm [&_p]:text-muted-foreground">
    <h2>Модалка без хранилища</h2>
    <p>Открыта поверх модалки со списками. В адресе её нет; «Назад» закрывает именно её.</p>
    <div class="flex flex-wrap items-center gap-3">
      <FloatingMenu
        label="Меню этой модалки"
        items={[{ label: 'Закрыть её', onSelect: () => m.modals.close() }]}
      />
    </div>
  </div>
{/snippet}

