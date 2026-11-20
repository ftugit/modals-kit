import { describe, expect, it } from 'vitest'
import { driveNodeActions, driveNodeActionsVisible } from './actions.js'

const CAPS = { canWrite: true, canShare: true }

describe('driveNodeActions', () => {
  it('обычный узел: скачивание и действия записи в порядке плана', () => {
    const ids = driveNodeActions({ starred: false }, CAPS, { canDownload: true }).map((a) => a.id)
    expect(ids).toEqual(['download', 'star', 'rename', 'move', 'copy', 'trash-action', 'access'])
  })

  it('переключатель «Важное» и destructive-удаление', () => {
    const actions = driveNodeActions({ starred: true }, CAPS)
    expect(actions.find((a) => a.id === 'star')?.label).toBe('Снять важное')
    expect(actions.find((a) => a.id === 'trash-action')?.destructive).toBe(true)
  })

  it('корзина: только восстановление и окончательное удаление', () => {
    const ids = driveNodeActions({ starred: false }, CAPS, { trashed: true }).map((a) => a.id)
    expect(ids).toEqual(['restore', 'purge'])
  })

  it('без прав записи остаются скачивание и доступы', () => {
    const ids = driveNodeActions({ starred: false }, { canWrite: false, canShare: true }, { canDownload: true }).map((a) => a.id)
    expect(ids).toEqual(['download', 'access'])
  })
})

describe('driveNodeActionsVisible', () => {
  it('мобильный — 2, широкий — 5', () => {
    expect(driveNodeActionsVisible(375)).toBe(2)
    expect(driveNodeActionsVisible(1024)).toBe(5)
    expect(driveNodeActionsVisible(0)).toBe(5)
  })
})
