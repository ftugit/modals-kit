// Тексты об ошибке ключа должны соответствовать тому, кто реально проверяет:
// длину — общий парсер, управляющие символы ASCII — только боевой пул.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STORAGE_MESSAGES } from '#content/user/messages.js'
import { STORAGE_POOL_MESSAGES, storageServerForm } from './form.js'

const poolSource = readFileSync(new URL('../../server/app-storage.server.ts', import.meta.url), 'utf8')
const parserSource = readFileSync(new URL('../../hooks/storage-server-form/parse.ts', import.meta.url), 'utf8')

describe('storage.key-invalid: текст там, где стоит проверка', () => {
  it('общий словарь описывает только длину', () => {
    expect(STORAGE_MESSAGES['storage.key-invalid']).toBe('Ключ шифрования файлов должен содержать от 8 до 256 символов')
    expect(STORAGE_MESSAGES['storage.key-invalid']).not.toMatch(/ASCII|пул/i)
  })

  it('уточнение про ASCII несёт форма пула', () => {
    expect(STORAGE_POOL_MESSAGES['storage.key-invalid']).toContain('без управляющих символов ASCII')
    expect(storageServerForm.messages?.['storage.key-invalid']).toBe(STORAGE_POOL_MESSAGES['storage.key-invalid'])
  })

  it('обещания в текстах совпадают с кодом проверок', () => {
    // пул действительно отклоняет C0 и DEL, общий парсер — нет
    expect(poolSource).toMatch(/rawEncKey\.length < 8 \|\| rawEncKey\.length > 256 \|\| \/\[\\u0000-\\u001f\\u007f\]\/\.test\(rawEncKey\)/)
    expect(parserSource).toMatch(/encryptionKey\.length < 8 \|\| encryptionKey\.length > 256/)
    expect(parserSource.match(/\\u0000/g) ?? []).toHaveLength(0)
  })

  it('ни один из текстов не обещает «печатных» символов', () => {
    for (const text of [STORAGE_MESSAGES['storage.key-invalid'], STORAGE_POOL_MESSAGES['storage.key-invalid']]) {
      expect(text).not.toContain('печатных')
    }
  })
})
