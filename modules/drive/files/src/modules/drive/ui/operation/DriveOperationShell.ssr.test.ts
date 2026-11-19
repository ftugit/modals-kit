import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import type { DriveOperationData } from '../../types.js'
import DriveMkdir from '../mkdir/DriveMkdir.svelte'

vi.mock('$app/env', () => ({ browser: false }))
vi.mock('$app/navigation', () => ({ goto: async () => {} }))

const initial: DriveOperationData = {
  enabled: true,
  fact: null,
  returnTo: '/drive?drive=2',
  action: '/drive/mkdir',
  parentId: null,
  parent: null,
  node: null,
  caps: { canRead: true, canWrite: true, canShare: true },
  shares: [],
  subjectOptions: [],
  tokens: [],
  storageError: null,
  davEnabled: true,
  values: {
    name: '',
    targetId: null,
    targetLabel: 'Корень диска',
    starred: false,
    subjects: [],
    uid: '',
    role: 'viewer',
    tokenId: '',
    label: '',
  },
  quota: { used: 0, limit: 0, remaining: 0 },
}

describe('DriveOperationShell', () => {
  it('выводит hidden return_to и parent_id из описания формы', () => {
    const { body } = render(DriveMkdir, { props: { initial } })
    expect(body).toContain('name="return_to"')
    expect(body).toContain('value="/drive?drive=2"')
    expect(body).toContain('name="parent_id"')
    expect(body).toContain('name="name"')
  })
})
