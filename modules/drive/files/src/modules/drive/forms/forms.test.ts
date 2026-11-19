import { describe, expect, it } from 'vitest'
import {
  driveCopyForm,
  driveMkdirForm,
  driveMoveForm,
  driveShareForm,
  driveUploadForm,
} from './index.js'

describe('фабрики форм «Диска»', () => {
  it('mkdir: parent_id/return_to скрыты, видимое поле только name', () => {
    const form = driveMkdirForm({ parentId: null, returnTo: '/drive' })
    expect(form.byName.parent_id).toBeTruthy()
    expect(form.byName.return_to).toBeTruthy()
    expect(form.byName.name).toBeTruthy()
    expect(form.fields.map((field) => field.name)).toEqual(['parent_id', 'return_to', 'name'])
  })

  it('upload: только file и скрытые адреса', () => {
    expect(driveUploadForm({ returnTo: '/drive' }).fields.map((field) => field.name)).toEqual([
      'parent_id',
      'return_to',
      'file',
    ])
  })

  it('move/copy: target_id — скрытое поле, а не select', () => {
    for (const form of [driveMoveForm({ returnTo: '/drive' }), driveCopyForm({ returnTo: '/drive' })]) {
      expect(form.byName.target_id?.input).toBe('hidden')
      expect(form.byName.node_id).toBeTruthy()
    }
  })

  it('share: subjects multiselect и role, без uid', () => {
    const form = driveShareForm({
      returnTo: '/drive',
      subjectOptions: [{ value: 'u1', label: 'Аня' }],
      values: { subjects: ['u1'] },
    })
    expect(form.byName.subjects?.input).toBe('multiselect')
    expect(form.byName.subjects?.options).toEqual([{ value: 'u1', label: 'Аня' }])
    expect(form.byName.role).toBeTruthy()
    expect(form.byName.uid).toBeUndefined()
  })
})
