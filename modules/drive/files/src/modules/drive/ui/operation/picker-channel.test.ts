import { describe, expect, it } from 'vitest'
import { DRIVE_PICKER_CHANNEL_PREFIX, drivePickerChannel } from './picker-channel.js'

describe('канал пикера «Диска»', () => {
  it('ключ строится из имени параметра', () => {
    expect(drivePickerChannel('target_id')).toBe(`${DRIVE_PICKER_CHANNEL_PREFIX}target_id`)
    expect(drivePickerChannel('target_id')).not.toBe(drivePickerChannel('id'))
  })
})
