import { describe, expect, it } from 'vitest'
import {
  DRIVE_PICKER_CHANNEL_PREFIX,
  drivePickerChannel,
  isSingleDriveTarget,
  nextDrivePickSeq,
} from './picker-channel.js'

describe('канал пикера «Диска»', () => {
  it('ключ строится из имени параметра', () => {
    expect(drivePickerChannel('target_id')).toBe(`${DRIVE_PICKER_CHANNEL_PREFIX}target_id`)
    expect(drivePickerChannel('target_id')).not.toBe(drivePickerChannel('id'))
  })

  it('seq монотонный', () => {
    const first = nextDrivePickSeq()
    expect(nextDrivePickSeq()).toBe(first + 1)
  })

  it('single-guard: UUID и явный null — да, всё остальное — нет', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    expect(isSingleDriveTarget({ seq: 1, mode: 'single', id, label: 'a' })).toBe(true)
    expect(isSingleDriveTarget({ seq: 1, mode: 'single', id: null, label: '' })).toBe(true)
    expect(isSingleDriveTarget({ seq: 1, mode: 'multiple', id: null, ids: [], label: '' })).toBe(false)
    expect(isSingleDriveTarget({ seq: 1, mode: 'single', id, ids: [], label: 'a' })).toBe(false)
    expect(isSingleDriveTarget({ seq: 1, id, label: 'a' })).toBe(false)
    expect(isSingleDriveTarget({ seq: 1, mode: 'single', id: 'a,b', label: '' })).toBe(false)
    expect(isSingleDriveTarget({ seq: 1, mode: 'single', label: '' })).toBe(false)
  })
})
