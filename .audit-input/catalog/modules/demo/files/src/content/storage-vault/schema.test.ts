import { describe, expect, it } from 'vitest'
import { storageVaultForm, storageVaultSchema } from './schema.js'

const values = {
  slot: 's3_main',
  url: 's3://key:secret@s3.example.com/bucket/app',
  storage_mb: '8',
  file_mb: '2',
}

describe('storage vault: совместимость разбора ключа', () => {
  it.each([
    ['ASCII control внутри', 'abcd\u0001efgh'],
    ['ASCII DEL внутри', 'abcd\u007fefgh'],
    ['Unicode format', 'abcd\u200befgh'],
    ['Unicode', 'ключшифрования'],
  ])('сохраняет %s', (_label, key) => {
    const result = storageVaultSchema.parse({ ...values, encryption_key: key })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.entry.encryptionKey).toBe(key)
  })

  it('применяет trim и не добавляет пустой ключ', () => {
    const trimmed = storageVaultSchema.parse({ ...values, encryption_key: '  abcdefgh  ' })
    expect(trimmed.ok).toBe(true)
    if (trimmed.ok) expect(trimmed.entry.encryptionKey).toBe('abcdefgh')
    const empty = storageVaultSchema.parse({ ...values, encryption_key: '   ' })
    expect(empty.ok).toBe(true)
    if (empty.ok) expect(empty.entry.encryptionKey).toBeUndefined()
  })

  it.each([7, 257])('отклоняет непустой ключ длиной %i', (length) => {
    const result = storageVaultSchema.parse({ ...values, encryption_key: 'a'.repeat(length) })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some((issue) => issue.code === 'storage.key-invalid')).toBe(true)
  })

  it('текст об ошибке ключа не приписывает сейфу правило пула', () => {
    // Управляющие символы ASCII отклоняет только боевой пул; сейф проверяет длину.
    const message = storageVaultForm.messages?.['storage.key-invalid'] ?? ''
    expect(message).toBe('Ключ шифрования файлов должен содержать от 8 до 256 символов')
    expect(message).not.toMatch(/ASCII|пул/i)
  })
})
