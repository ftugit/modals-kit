<script lang="ts">
  import { Select } from '$lib/ui'
  import FloatingMenu from './FloatingMenu.svelte'
  import { useModals } from '$lib/modals/svelte'
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

<div class="body">
  <h2>Select внутри модалки</h2>
  <p>Список лежит в своём контейнере в <code>body</code>, а частью ловушки фокуса
     модалки его объявляет <code>aria-controls</code> на триггере — штатный
     механизм Zag «follow controlled elements» (решение D31).</p>
  <label>Жанр<Select options={genres} bind:value={picked} placeholder="Выберите жанр" /></label>
  <label>Несколько<Select options={genres} bind:value={many} multiple placeholder="Любые" /></label>
  <label>Несколько, закрывать после выбора<Select options={genres} bind:value={manyClose} multiple closeOnSelect placeholder="Любые" /></label>
  <p class="picked">Выбрано: <b>{picked}</b> / [{many.join(', ')}] / closeOnSelect [{manyClose.join(', ')}]</p>

  <div class="row">
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
    <button
      type="button"
      class="modal-trigger"
      onclick={() => m.modals.openLayer({ content: storagelessHere })}
    >
      Без хранилища поверх
    </button>
    <span class="menu-result">Из меню: <b>{действие}</b></span>
  </div>
  <p>Меню — второй потребитель того же <code>host.floating</code>, что и список:
     Escape, клик мимо и лист на узком экране приходят от хоста.</p>
</div>

{#snippet storagelessHere()}
  <div class="body">
    <h2>Модалка без хранилища</h2>
    <p>Открыта поверх модалки со списками. В адресе её нет; «Назад» закрывает именно её.</p>
    <div class="row">
      <FloatingMenu
        label="Меню этой модалки"
        items={[{ label: 'Закрыть её', onSelect: () => m.modals.close() }]}
      />
    </div>
  </div>
{/snippet}

<style>
  .body { padding: 1.25rem; display: flex; flex-direction: column; gap: .75rem; }
  h2 { margin: 0; font-size: 1.1rem; }
  p { margin: 0; color: var(--muted-foreground); font-size: .85rem; }
  label { display: flex; flex-direction: column; gap: .3rem; font-size: .85rem; }
  .picked { font-size: .8rem; }
  .row { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
  .menu-result { font-size: .8rem; }
  code { font-size: .8em; }
</style>
