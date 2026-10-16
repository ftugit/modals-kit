// Серверная половина `/fields`: приём обеих форм через слои lib/form и хранение
// в кэше процесса (`localStore`), а не в базе — демо держит один набор полей и
// один пример записи. Маршрут тонкий: тело разбирают слои, не он.
import type { RequestEvent } from '@sveltejs/kit'
import type { FieldSetItem } from '#lib/form/index.js'
import { createFormHandler, type Handled } from '#lib/form/server.js'
import { localStore } from '#lib/server/cache.js'
import { SECURITY_LAYERS } from '#lib/server/form-security.js'
import '#lib/components/form/extend.js'
import { IMAGE_MAX_BYTES, collectionForm, recordForm, type SavedRecord, type SavedSet } from './forms'

// Два ключа — набор и запись; срок не нужен: новое значение заменяет старое.
const store = localStore.scope('fields-demo', { max: 2 })
export const savedSet = (): SavedSet | null => store.get<SavedSet>('set') ?? null
export const savedRecord = (): SavedRecord | null => store.get<SavedRecord>('record') ?? null

/* ── набор ────────────────────────────────────────────────────────── */

// Пределы набора проверила форма (на обеих сторонах): `execute` получает приведённый список.
const builder = createFormHandler<{ count: number }, RequestEvent>({
  description: collectionForm(),
  order: SECURITY_LAYERS,
  execute({ values, commit }) {
    const fields = values['props'] as readonly FieldSetItem[]
    store.set<SavedSet>('set', { version: (savedSet()?.version ?? 0) + 1, fields }, Infinity)
    commit()
    return { data: { count: fields.length } }
  },
})

/* ── запись ───────────────────────────────────────────────────────── */

/** Тип изображения по первым байтам: заявленный браузером тип не доказательство. */
function sniff(b: Uint8Array): string | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, k) => b[i + k] === x)
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  return null
}

/** base64 без `Buffer`: маршрут не привязан к Node. */
function base64(b: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(bin)
}

const show = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : String(v))

const record = createFormHandler<{ title: string }, RequestEvent>({
  description: recordForm(null),
  // Форму записи сервер строит из сохранённого набора, а не из тела запроса: поле,
  // которого в наборе уже нет, — отказ «неизвестное поле», а не тихий приём.
  source: {
    resolve: async () => recordForm(savedSet()),
    revision: async () => savedSet()?.version ?? 1,
  },
  order: SECURITY_LAYERS,
  limits: { maxFileSize: IMAGE_MAX_BYTES },
  async execute({ values, commit, fail }) {
    const file = values['image'] as File
    const bytes = new Uint8Array(await file.arrayBuffer())
    const type = sniff(bytes)
    if (!type) return fail([{ message: 'не изображение', code: 'accept', path: ['image'], params: { name: file.name } }])
    const fields = savedSet()?.fields ?? []
    store.set<SavedRecord>('record', {
      n: (savedRecord()?.n ?? 0) + 1,
      title: String(values['title']),
      image: `data:${type};base64,${base64(bytes)}`,
      entries: fields.map((s) => ({ label: s.label, value: show(values[`u_${s.name}`]) })),
    }, Infinity)
    commit()
    return { data: { title: String(values['title']) } }
  },
})

export const handleBuilder = (request: Request, from: 'action' | 'fetch', event: RequestEvent): Promise<Handled> =>
  builder(request, from, event)
export const handleRecord = (request: Request, from: 'action' | 'fetch', event: RequestEvent): Promise<Handled> =>
  record(request, from, event)
