import { describe, expect, it } from 'vitest'
import { defaults } from '../../config.js'
import { createUserChecks } from '../../checks.js'
import { specAvatar } from '../../spec-avatar.js'
import { IMAGE_RAW_MAX_BYTES, profileForm } from './form.js'

describe('профиль: картинка — обычное поле файла', () => {
  it('тип `file`, приёмные типы и предел файла 20 КБ — правила поля', () => {
    const f = profileForm.byName['photo']!
    expect(f.kind).toBe('file')
    expect(f.multiple).toBeUndefined()
    const kinds = profileForm.constraintsOf('photo').map((c) => c.kind)
    expect(kinds).toContain('accept')
    expect(kinds).toContain('maxSize')
    // предел — вес готового кадра: сервер картинку не сжимает
    expect(IMAGE_RAW_MAX_BYTES).toBe(20_480)
    expect(profileForm.constraintsOf('photo')).toContainEqual({
      kind: 'maxSize',
      bytes: specAvatar.maxBytes,
    })
  })

  it('соответствие спеке проверяет `avatar-spec`: сервер не конвертирует', () => {
    const checks = createUserChecks({ nicknameForbidden: defaults.nicknameForbidden })
    expect(checks.has('avatar-spec')).toBe(true)
    const names = profileForm.byName['photo']!.validators
      .map((ref) => {
        try { return (profileForm.registry.validators.resolve(ref) as { asyncCheck?: { name: string } }).asyncCheck?.name }
        catch { return undefined }
      })
      .filter(Boolean)
    expect(names).toContain('avatar-spec')
  })

  it('содержимое судит общее правило `image` (асинхронная проверка поля)', () => {
    const d = profileForm
    const asyncNames = d.byName['photo']!.validators
      .map((ref) => {
        try { return (d.registry.validators.resolve(ref) as { asyncCheck?: { name: string } }).asyncCheck?.name }
        catch { return undefined }
      })
      .filter(Boolean)
    expect(asyncNames).toContain('image')
  })

  it('спека — единственное место параметров картинки; в конфиге их нет', () => {
    expect(specAvatar).toEqual({ width: 200, height: 200, maxBytes: 20_480, format: 'jpeg' })
    expect(Object.keys(defaults).filter((k) => k.startsWith('avatar'))).toEqual([])
  })
})
