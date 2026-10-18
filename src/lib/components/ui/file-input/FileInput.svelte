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
  import { onMount } from 'svelte'
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { cn } from '../../../utils'
  import { inputVariants } from '../field/field'

  interface Props extends Omit<HTMLInputAttributes, 'size' | 'type' | 'value'> {
    size?: 'sm' | 'md' | 'lg'
    /** Показать выбранные файлы списком: картинки миниатюрой, остальные значком. */
    preview?: boolean
    /** Подпись кнопки уборки файла (aria-label и title). */
    removeLabel?: string
  }

  let {
    size,
    preview = false,
    removeLabel = 'Убрать файл',
    class: cls,
    disabled,
    onchange,
    ...rest
  }: Props = $props()

  let mounted = $state(false)
  let inputEl = $state<HTMLInputElement | null>(null)

  /** Выбранное: файл + адрес миниатюры у картинок (у остальных — значок). */
  type Entry = { file: File; url?: string }
  let entries = $state<Entry[]>([])

  /** Номер выбора и живость компонента: запоздавший ответ компрессора не рисуем. */
  let picks = 0
  let alive = true

  function revokeAll(): void {
    for (const e of entries) if (e.url) URL.revokeObjectURL(e.url)
  }

  /** Миниатюра: compressorjs → objectURL сжатого; сжать не вышло → оригинала. */
  async function thumbnail(gen: number, entry: Entry): Promise<void> {
    let url: string
    try {
      const { default: Compressor } = await import('compressorjs')
      url = await new Promise<string>((resolve, reject) => {
        new Compressor(entry.file, {
          maxWidth: 80,
          maxHeight: 80,
          quality: 0.8,
          success: (blob) => resolve(URL.createObjectURL(blob)),
          error: reject,
        })
      })
    } catch {
      url = URL.createObjectURL(entry.file)
    }
    if (alive && gen === picks) entry.url = url
    else URL.revokeObjectURL(url)
  }

  function sync(files: FileList | null): void {
    picks += 1
    revokeAll()
    entries = [...(files ?? [])].map((file) => ({ file }))
    const gen = picks
    for (const e of entries) {
      if (e.file.type.startsWith('image/')) void thumbnail(gen, e)
    }
  }

  onMount(() => {
    mounted = true
    return () => {
      alive = false
      revokeAll()
    }
  })

  const sizeOf = (b: number): string =>
    b < 1024 ? `${b} Б` : b < 1_048_576 ? `${Math.round(b / 1024)} КиБ` : `${(b / 1_048_576).toFixed(1)} МиБ`

  /** Убрать файл: одиночное поле — очистить; список — пересобрать без него. */
  function removeAt(index: number): void {
    const input = inputEl
    if (!input) return
    if (input.multiple && entries.length > 1 && typeof DataTransfer !== 'undefined') {
      const dt = new DataTransfer()
      entries.forEach((e, i) => {
        if (i !== index) dt.items.add(e.file)
      })
      input.files = dt.files
    } else {
      input.value = ''
    }
    // выбор изменился вне диалога — сообщаем тем же событием, что читает форма
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
</script>

<input
  bind:this={inputEl}
  type="file"
  {disabled}
  class={inputVariants({
    size,
    class: cn(
      'h-auto py-1.5 file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-sm file:text-foreground',
      cls,
    ),
  })}
  {...rest}
  onchange={(e) => {
    sync(inputEl?.files ?? null)
    onchange?.(e)
  }}
/>

{#if preview && mounted && entries.length}
  <!-- data-file-list/item — ручки тестов; карточки в духе Attachment (shadcn) -->
  <ul class="flex flex-col gap-2" data-file-list>
    {#each entries as e, i (e.file.name + e.file.lastModified + i)}
      <li class="flex items-center gap-2.5 rounded-lg border bg-card p-2" data-file-item>
        <span
          class="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground"
        >
          {#if e.url}
            <img
              src={e.url}
              alt=""
              class="h-full w-full object-cover"
              onerror={() => {
                // сжатый или оригинал — раз не отрисовался, остаётся значок файла
                if (e.url) {
                  URL.revokeObjectURL(e.url)
                  e.url = undefined
                }
              }}
            />
          {:else}
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4">
              <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
              <path d="M14 2v4a2 2 0 0 0 2 2h4" />
            </svg>
          {/if}
        </span>
        <span class="min-w-0 flex-1 leading-tight">
          <span class="block truncate text-sm font-medium">{e.file.name}</span>
          <span class="block text-xs text-muted-foreground">{sizeOf(e.file.size)}</span>
        </span>
        <button
          type="button"
          class="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          aria-label={`${removeLabel}: ${e.file.name}`}
          title={removeLabel}
          onclick={() => removeAt(i)}
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" class="size-4 fill-none stroke-current stroke-2">
            <path d="m4 4 8 8m0-8-8 8" />
          </svg>
        </button>
      </li>
    {/each}
  </ul>
{/if}
