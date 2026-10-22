<script lang="ts">
  /**
   * Выбор файла(ов). Своё значение у поля одно — выбранные файлы; задать его
   * разметкой нельзя (браузер запрещает писать `value` у type="file"), поэтому
   * `value` сюда не принимается: страница, вернувшаяся с ошибкой, просит
   * выбрать файл заново.
   *
   * `preview` — список выбранных файлов под полем (опция; по образцу
   * `Attachment` из shadcn): картинки — миниатюрой, остальные — значком файла;
   * имя и вес; крестик убирает файл из выбора (одиночное поле — очищает,
   * список — через `DataTransfer`, без его поддержки — весь выбор). Без JS
   * список не рисуется: остаётся нативное поле — выбор файла работает и без
   * скриптов.
   *
   * Миниатюра картинки — через compressorjs (решение владельца; зависимость
   * уже стоит ради аватара, грузится тем же ленивым чанком): пережим до
   * 80×80 — карточка 40 CSS px с запасом на retina, заодно честит
   * EXIF-поворот и не держит в памяти полноформатное фото. Сжать не вышло —
   * objectURL оригинала; и он не отрисовался — значок файла. Адреса
   * освобождаются при смене выбора и разборке компонента.
   */
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { inputVariants } from '../field/field'

  interface Props extends Omit<HTMLInputAttributes, 'size' | 'type' | 'value' | 'files'> {
    size?: 'sm' | 'md' | 'lg'
    /** Выбранные файлы нативного `<input type="file">` (`bind:files`). */
    files?: FileList
    /** Forwarded ref: узел <input> в руки потребителю (фокус, очистка, слушатели формы; см. Input). */
    ref?: (el: HTMLInputElement | null) => void
    /** Показать выбранные файлы списком: картинки миниатюрой, остальные значком. */
    preview?: boolean
    /** Подпись кнопки уборки файла (aria-label и title). */
    removeLabel?: string
  }

  let {
    size,
    files = $bindable(),
    ref,
    preview = false,
    removeLabel = 'Убрать файл',
    class: cls,
    onchange,
    ...rest
  }: Props = $props()

  let inputEl = $state<HTMLInputElement | null>(null)
  let prevFiles: FileList | undefined

  /** Выбранное: файл + адрес миниатюры у картинок (у остальных — значок). */
  type Entry = { file: File; url?: string }
  let entries = $state<Entry[]>([])

  /** Номер выбора: запоздавший ответ компрессора не рисуем. */
  let picks = 0
  let live = true
  const revoke = (u?: string) => u && URL.revokeObjectURL(u)

  function setList(list?: FileList | null): void {
    const gen = ++picks
    entries.forEach((e) => revoke(e.url))
    entries = preview ? Array.from(list ?? [], (file): Entry => ({ file })) : []
    entries.forEach((e) => {
      if (e.file.type.startsWith('image/')) {
        const put = (b: Blob) => {
          const u = URL.createObjectURL(b)
          if (live && gen === picks) e.url = u
          else revoke(u)
        }
        import('compressorjs').then(
          ({ default: C }) => new C(e.file, { maxWidth: 80, maxHeight: 80, quality: 0.8, success: put, error: () => put(e.file) }),
          () => put(e.file),
        )
      }
    })
  }

  $effect(() => {
    live = true
    const el = inputEl
    ref?.(el)
    if (files !== prevFiles) {
      prevFiles = files
      if (el) {
        if (files) el.files = files
        else el.value = ''
      }
      setList(files)
    }
    return () => {
      live = false
      ref?.(null)
      entries.forEach((e) => revoke(e.url))
    }
  })
</script>

<input
  bind:this={inputEl}
  type="file"
  class={inputVariants({
    size,
    class: ['h-auto py-1.5 file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-sm file:text-foreground', cls],
  })}
  {...rest}
  onchange={(e) => {
    const next = e.currentTarget.files
    files = next ?? undefined
    setList(next)
    onchange?.(e)
    prevFiles = files
  }}
/>

{#if preview && entries.length}
  <!-- data-file-list/item — ручки тестов; карточки в духе Attachment (shadcn) -->
  <ul class="flex flex-col gap-2" data-file-list>
    {#each entries as e, i}
      <li class="flex items-center gap-2.5 rounded-lg border bg-card p-2" data-file-item>
        <span
          class="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground"
        >
          {#if e.url}
            <img
              src={e.url}
              alt=""
              class="size-full object-cover"
              onerror={() => {
                revoke(e.url)
                e.url = undefined
              }}
            />
          {:else}
            <svg aria-hidden="true" viewBox="0 0 24 24" class="size-4 fill-none stroke-current stroke-2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm0 0v6h6" />
            </svg>
          {/if}
        </span>
        <span class="min-w-0 flex-1 leading-tight">
          <span class="block truncate text-sm font-medium">{e.file.name}</span>
          <span class="block text-xs text-muted-foreground">{e.file.size < 1024 ? `${e.file.size} Б` : e.file.size < 1048576 ? `${Math.round(e.file.size / 1024)} КиБ` : `${(e.file.size / 1048576).toFixed(1)} МиБ`}</span>
        </span>
        <button
          type="button"
          class="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          aria-label={`${removeLabel}: ${e.file.name}`}
          title={removeLabel}
          onclick={() => {
            if (!inputEl) return
            if (inputEl.multiple && entries[1] && window.DataTransfer) {
              const dt = new DataTransfer()
              entries.forEach((x, j) => j !== i && dt.items.add(x.file))
              inputEl.files = dt.files
            } else inputEl.value = ''
            inputEl.dispatchEvent(new Event('change', { bubbles: true }))
          }}
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" class="size-4 fill-none stroke-current stroke-2">
            <path d="m4 4 8 8m0-8-8 8" />
          </svg>
        </button>
      </li>
    {/each}
  </ul>
{/if}
