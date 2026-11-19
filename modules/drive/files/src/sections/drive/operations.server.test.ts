import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveAppStorage = vi.hoisted(() => vi.fn())
const purgeDriveNode = vi.hoisted(() => vi.fn())
const uploadDriveFile = vi.hoisted(() => vi.fn())
const moveDriveNode = vi.hoisted(() => vi.fn())
const copyDriveNode = vi.hoisted(() => vi.fn())

vi.mock('#core/server/app-storage.server.js', () => ({ resolveAppStorage }))
vi.mock('#core/server/db.server.js', () => ({ db: {} }))
vi.mock('#modules/user/base/service/gateway.server.js', () => ({
  auth: () => ({
    enabled: true,
    actor: async () => ({ ok: true, value: { id: 'actor', permissions: [] } }),
  }),
}))
vi.mock('$app/env/private', () => ({ AUTH_SEAL_SECRET: 'x'.repeat(32) }))
vi.mock('#modules/drive/service/mutate.js', () => ({
  copyDriveNode,
  createDriveFolder: vi.fn(),
  moveDriveNode,
  purgeDriveNode,
  renameDriveNode: vi.fn(),
  restoreDriveNode: vi.fn(),
  shareDriveNodeMany: vi.fn(),
  starDriveNode: vi.fn(),
  trashDriveNode: vi.fn(),
  unshareDriveNode: vi.fn(),
}))
vi.mock('#modules/drive/service/upload.js', () => ({ uploadDriveFile }))
vi.mock('#modules/drive/service/tokens.js', () => ({
  issueDriveDavToken: vi.fn(),
  revokeDriveDavToken: vi.fn(),
}))

import { driveStorageGate, runDriveOperation } from './operations.server.js'

const storage = { put: vi.fn(), del: vi.fn(), serve: vi.fn() }

const event = {
  url: new URL('https://local.invalid/drive/upload'),
  setHeaders: vi.fn(),
} as never

describe('driveStorageGate', () => {
  beforeEach(() => resolveAppStorage.mockReset())

  it('нет хранилища — доменный код, не исключение', async () => {
    resolveAppStorage.mockResolvedValue({ storage: null, writable: false, activeMode: 'empty' })
    await expect(driveStorageGate()).resolves.toEqual({
      storage: null,
      code: 'drive.storage-unavailable',
    })
  })

  it('только чтение — отдельный код', async () => {
    resolveAppStorage.mockResolvedValue({ storage, writable: false, activeMode: 'pool' })
    await expect(driveStorageGate()).resolves.toEqual({
      storage,
      code: 'drive.storage-readonly',
    })
  })

  it('пишущее хранилище проходит', async () => {
    resolveAppStorage.mockResolvedValue({ storage, writable: true, activeMode: 'pool' })
    await expect(driveStorageGate()).resolves.toEqual({ storage, code: null })
  })
})

describe('операции без хранилища', () => {
  beforeEach(() => {
    resolveAppStorage.mockReset()
    purgeDriveNode.mockReset()
    uploadDriveFile.mockReset()
    moveDriveNode.mockReset()
    copyDriveNode.mockReset()
  })

  it('upload отказывает доменным кодом до записи узла', async () => {
    resolveAppStorage.mockResolvedValue({ storage: null, writable: false, activeMode: 'empty' })
    const outcome = await runDriveOperation('upload', event, {
      file: new File([new Uint8Array([1])], 'a.txt'),
      return_to: '/drive',
    })
    expect(outcome).toMatchObject({ ok: false, code: 'drive.storage-unavailable', field: 'file' })
    expect(uploadDriveFile).not.toHaveBeenCalled()
  })

  it('move ведёт в target, copy — тоже в target', async () => {
    resolveAppStorage.mockResolvedValue({ storage, writable: true, activeMode: 'pool' })
    const target = '22222222-2222-4222-8222-222222222222'
    moveDriveNode.mockResolvedValue({ ok: true, value: {} })
    copyDriveNode.mockResolvedValue({ ok: true, value: {} })
    const values = {
      node_id: '11111111-1111-4111-8111-111111111111',
      target_id: target,
      return_to: '/drive',
    }
    await expect(runDriveOperation('move', event, values)).resolves.toMatchObject({
      ok: true,
      next: `/drive/${target}`,
    })
    await expect(runDriveOperation('copy', event, values)).resolves.toMatchObject({
      ok: true,
      next: `/drive/${target}`,
    })
  })

  it('purge без хранилища остаётся успехом и не зовёт del', async () => {
    resolveAppStorage.mockResolvedValue({ storage: null, writable: false, activeMode: 'empty' })
    purgeDriveNode.mockResolvedValue({ ok: true, value: { deleted: 1, freed: 0 } })
    const outcome = await runDriveOperation('purge', event, {
      node_id: '11111111-1111-4111-8111-111111111111',
      return_to: '/drive/trash',
    })
    expect(outcome).toMatchObject({ ok: true, next: '/drive/trash' })
    expect(purgeDriveNode).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      null,
    )
  })
})
