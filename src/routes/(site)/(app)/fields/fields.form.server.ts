// Самодостаточные серверные POST-обработчики конструктора `/fields` через `#hooks/component-form`.
// Подхватываются автоматически (`import.meta.glob` в `hooks/component-form/server.ts`),
// работают одинаково с JS и без JS без дублирующих `+server.ts` и ручных `actions`.
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { claimQuery, nextSearch } from '#lib/address/keys.js'
import type { FieldSetItem } from '#lib/form/index.js'
import { probeImageHeader } from '#lib/image/probe.js'
import { localStore } from '#server/cache.server.js'
import '#components/form/extend.js'
import {
  IMAGE_MAX_BYTES,
  collectionForm,
  maxFieldsOf,
  recordForm,
  resetForm,
  type FieldsStep,
  type SavedRecord,
  type SavedSet,
} from './forms.js'

claimQuery('fields', 'step', 'step.*')

const store = localStore.scope('fields-demo', { max: 2 })

export const savedSet = (): SavedSet | null => store.get<SavedSet>('set') ?? null
export const savedRecord = (): SavedRecord | null => store.get<SavedRecord>('record') ?? null
export const clearFieldsDemo = (): void => store.clear()

const stepRedirect = (url: URL, step: FieldsStep): string =>
  `/fields${nextSearch('fields', url.search, { step })}`

const isGif = (b: Uint8Array): boolean =>
  b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38

const imageMimeOf = (b: Uint8Array): string | null =>
  probeImageHeader(b)?.format ?? (isGif(b) ? 'image/gif' : null)

function toBase64(b: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(bin)
}

registerComponentForm({
  id: collectionForm().id,
  description: (event) => collectionForm(undefined, maxFieldsOf(event.url.searchParams.get('limit'))),
  execute({ values, commit }) {
    const fields = values['props'] as readonly FieldSetItem[]
    store.set<SavedSet>('set', { version: (savedSet()?.version ?? 0) + 1, fields }, Infinity)
    commit()
    return { data: { count: fields.length } }
  },
  redirectOnSuccess: (event) => stepRedirect(event.url, 'fill'),
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
      const type = imageMimeOf(bytes)
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
  redirectOnSuccess: (event) => stepRedirect(event.url, 'result'),
})

registerComponentForm({
  description: resetForm(),
  execute({ commit }) {
    clearFieldsDemo()
    commit()
    return { data: { reset: true } }
  },
  redirectOnSuccess: (event) => stepRedirect(event.url, 'build'),
})
