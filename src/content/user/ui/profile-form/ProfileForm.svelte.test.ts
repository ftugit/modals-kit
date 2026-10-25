import { describe, expect, it } from 'vitest'
import { defaults } from '../../config.js'
import { SpecAvatar } from '../../spec-avatar.js'
import { IMAGE_RAW_MAX_BYTES, profileForm } from './form.js'

describe('профиль: картинка — обычное поле файла', () => {
  it('тип `file`, приёмные типы и предел исходника — правила поля', () => {
    const f = profileForm.byName['avatar']!
    expect(f.kind).toBe('file')
    expect(f.multiple).toBeUndefined()
    const kinds = profileForm.constraintsOf('avatar').map((c) => c.kind)
    expect(kinds).toContain('accept')
    expect(kinds).toContain('maxSize')
    expect(profileForm.constraintsOf('avatar')).toContainEqual({
      kind: 'maxSize',
      bytes: IMAGE_RAW_MAX_BYTES,
    })
  })

  it('содержимое судит общее правило `image` (асинхронная проверка поля)', () => {
    const d = profileForm
    const asyncNames = d.byName['avatar']!.validators
      .map((ref) => {
        try { return (d.registry.validators.resolve(ref) as { asyncCheck?: { name: string } }).asyncCheck?.name }
        catch { return undefined }
      })
      .filter(Boolean)
    expect(asyncNames).toContain('image')
  })

  it('спека — только параметры приведения, без валидаторов и путей', () => {
    expect(SpecAvatar).toEqual({ width: 200, height: 200, maxBytes: 20_480, format: 'jpeg' })
    expect(defaults.avatarEdge).toBe(SpecAvatar.width)
    expect(defaults.avatarMaxBytes).toBe(SpecAvatar.maxBytes)
  })
})
