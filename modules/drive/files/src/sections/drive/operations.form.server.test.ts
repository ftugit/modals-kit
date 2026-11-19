import { describe, expect, it, vi } from 'vitest'

vi.mock('#core/server/app-storage.server.js', () => ({ resolveAppStorage: vi.fn() }))
vi.mock('#core/server/db.server.js', () => ({ db: {} }))
vi.mock('#modules/user/base/service/gateway.server.js', () => ({ auth: () => ({}) }))
vi.mock('$app/env/private', () => ({ AUTH_SEAL_SECRET: 'x'.repeat(32) }))

import { driveSuccessRedirect } from './operations.form.server.js'
import { DRIVE_NOTICE_DONE } from '#modules/drive/source.js'

describe('driveSuccessRedirect', () => {
  it('читает result.redirect, а не data.next', () => {
    expect(driveSuccessRedirect({}, { redirect: '/drive/trash?drive=2' })).toBe(
      `/drive/trash?drive=2&notice=${encodeURIComponent(DRIVE_NOTICE_DONE)}`,
    )
  })

  it('dav-issue всегда inline: секрет не уходит в PRG', () => {
    expect(driveSuccessRedirect({ inlineSuccess: true }, { redirect: '/user/config/dav' })).toBe(
      'inline',
    )
  })

  it('внешний/пустой redirect — аварийный null', () => {
    expect(driveSuccessRedirect({}, {})).toBeNull()
    expect(driveSuccessRedirect({}, { redirect: 'https://evil.example/' })).toBeNull()
  })
})
