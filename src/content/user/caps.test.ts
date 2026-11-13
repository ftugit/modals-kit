import { describe, expect, it } from 'vitest'
import { defineCaps, type SessionSliceCaps } from './caps.js'

describe('defineCaps (P2-3)', () => {
  it('возвращает тот же объект флагов с типом карты sessions', () => {
    const flags = {
      canRead: true,
      canSeeDeleted: false,
      canRename: true,
      canRevoke: false,
      canHardDelete: false,
    }
    expect(defineCaps<'sessions'>(flags)).toBe(flags)
  })

  it('профильные флаги проходят карту (canOpenConfig необязателен)', () => {
    const flags = {
      canEdit: true,
      canDeleteProfile: false,
      canDeleteSeed: false,
      canReadBlocks: true,
      canBlock: false,
      canReadSessions: true,
      isOwn: false,
    }
    expect(defineCaps<'profile'>(flags)).toBe(flags)
  })
})

/*
 * Типовые негативные контроли — проверяет `svelte-check` (npm run check).
 * Расхождение флага домена и карты не компилируется. Если мутация сделает
 * карту/defineCaps всеядной, директивы станут неиспользованными и check упадёт
 * («Unused '@ts-expect-error' directive»).
 */

// @ts-expect-error — лишний флаг не входит в карту sessions
defineCaps<'sessions'>({ canRead: true, canSeeDeleted: true, canRename: true, canRevoke: true, canHardDelete: true, canBogus: true })
// @ts-expect-error — пропущен обязательный флаг canRevoke
defineCaps<'sessions'>({ canRead: true, canSeeDeleted: true, canRename: true, canHardDelete: true })
// @ts-expect-error — неверный тип флага (canRead должен быть boolean)
defineCaps<'sessions'>({ canRead: 'yes', canSeeDeleted: true, canRename: true, canRevoke: true, canHardDelete: true })
// @ts-expect-error — лишний флаг не входит в карту profile
defineCaps<'profile'>({ canEdit: true, canDeleteProfile: true, canDeleteSeed: true, canReadBlocks: true, canBlock: true, canReadSessions: true, isOwn: true, canBogus: true })
// @ts-expect-error — пропущен обязательный флаг canEdit
defineCaps<'profile'>({ canDeleteProfile: true, canDeleteSeed: true, canReadBlocks: true, canBlock: true, canReadSessions: true, isOwn: true })
// @ts-expect-error — route data среза не может обойтись без флага карты (canHardDelete)
const slice: SessionSliceCaps = { canSeeDeleted: true, canRename: true, canRevoke: true }
void slice
