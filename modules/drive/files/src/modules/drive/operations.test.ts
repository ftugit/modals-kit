import { describe, expect, it } from 'vitest'
import { DRIVE_OPERATIONS, DRIVE_OPERATION_NAMES, driveOperationHref } from './operations.js'

describe('матрица операций «Диска»', () => {
  it('у успеха каждой операции есть явный тип', () => {
    for (const op of DRIVE_OPERATION_NAMES) {
      expect(['stay', 'target']).toContain(DRIVE_OPERATIONS[op].success)
    }
    expect(DRIVE_OPERATIONS.move.success).toBe('target')
    expect(DRIVE_OPERATIONS.copy.success).toBe('target')
    expect(DRIVE_OPERATIONS.share.success).toBe('stay')
    expect(DRIVE_OPERATIONS['dav-issue'].inlineSuccess).toBe(true)
  })

  it('target_id входит в адрес операции', () => {
    const target = '11111111-1111-4111-8111-111111111111'
    expect(driveOperationHref('move', { nodeId: '22222222-2222-4222-8222-222222222222', targetId: target })).toBe(
      `/drive/move?node_id=22222222-2222-4222-8222-222222222222&target_id=${target}`,
    )
  })

  it('внешний return_to не попадает в адрес', () => {
    expect(driveOperationHref('mkdir', { returnTo: 'https://evil.example/' })).toBe('/drive/mkdir')
  })
})
