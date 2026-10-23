// Самодостаточные серверные POST-обработчики конструктора `/fields` через `#hooks/component-form`.
// Подхватываются автоматически (`import.meta.glob` в `hooks/component-form/server.ts`),
// работают одинаково с JS и без JS без дублирующих `+server.ts` и ручных `actions`.
import { registerComponentForm } from '#hooks/component-form/server.js'
import type { FieldSetItem } from '#lib/form/index.js'
import { localStore } from '#lib/server/cache.js'
import '#lib/components/form/extend.js'
import {
  IMAGE_MAX_BYTES,
  collectionForm,
  demoQuery,
  maxFieldsOf,
  recordForm,
  resetForm,
  type SavedRecord,
  type SavedSet,
} from './forms.js'

const store = localStore.scope('fields-demo', { max: 2 })

export const savedSet = (): SavedSet | null => store.get<SavedSet>('set') ?? null
export const savedRecord = (): SavedRecord | null => store.get<SavedRecord>('record') ?? null
export const clearFieldsDemo = (): void => store.clear()

const limitTail = (url: URL): string => {
  const q = demoQuery(maxFieldsOf(url.searchParams.get('limit')))
  return q ? `&${q}` : ''
}

function sniffImageMime(b: Uint8Array): string | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, k) => b[i + k] === x)
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  return null
}

function toBase64(b: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(bin)
}

registerComponentForm({
  id: 'fields-builder',
  description: (event) => collectionForm(undefined, maxFieldsOf(event.url.searchParams.get('limit'))),
  execute({ values, commit }) {
    const fields = values['props'] as readonly FieldSetItem[]
    store.set<SavedSet>('set', { version: (savedSet()?.version ?? 0) + 1, fields }, Infinity)
    commit()
    return { data: { count: fields.length } }
  },
  redirectOnSuccess: (event) => `/fields?step=fill${limitTail(event.url)}`,
})

registerComponentForm({
  description: recordForm(null),
  source: {
    resolve: async () => recordForm(savedSet(), savedRecord()),
    revision: async () => savedSet()?.version ?? 1,
  },
  limits: { maxFileSize: IMAGE_MAX_BYTES },
  async execute({ values, commit, fail }) {
    const previous = savedRecord()
    const file = values['image'] as File | null
    let image = previous?.image ?? ''
    if (file) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const type = sniffImageMime(bytes)
      if (!type) {
        return fail([{ message: 'не изображение', code: 'accept', path: ['image'], params: { name: file.name } }])
      }
      image = `data:${type};base64,${toBase64(bytes)}`
    } else if (!image) {
      return fail([{ message: 'обязательно', code: 'required', path: ['image'] }])
    }
    const fields = savedSet()?.fields ?? []
    store.set<SavedRecord>(
      'record',
      {
        n: (previous?.n ?? 0) + 1,
        title: String(values['title']),
        image,
        values: Object.fromEntries(fields.map((s) => [s.name, values[`u_${s.name}`] ?? null])),
      },
      Infinity,
    )
    commit()
    return { data: { title: String(values['title']) } }
  },
  redirectOnSuccess: (event) => `/fields?step=result${limitTail(event.url)}`,
})

registerComponentForm({
  description: resetForm(),
  execute({ commit }) {
    clearFieldsDemo()
    commit()
    return { data: { reset: true } }
  },
  redirectOnSuccess: (event) => `/fields?step=build${limitTail(event.url)}`,
})
