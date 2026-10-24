// Реестр экранов ACL: каждая ветка отказа — экран с действием, а не «что-то
// пошло не так». Тест держит три вещи, которые глазом не проверить:
//   1. порядок проверок (субъект важнее доменного статуса);
//   2. покрытие всех кодов модели — новый `FailureKind` без экрана падает здесь;
//   3. действие-ссылку: экран, который обещает кнопку словами, обязан её нести.
import { DbFailure } from '#lib/db/errors.js'
import type { FailureKind } from '#lib/db/errors.js'
import { describe, expect, it } from 'vitest'
import { resolveAcl, type AclScreenCode } from './acl.js'

const MODEL_CODES: readonly FailureKind[] = [
  'validation',
  'forbidden',
  'not_found',
  'unsupported',
  'conflict',
  'database',
  'unavailable',
  'cursor',
  'transaction',
  'post_commit',
  'schema_pending',
]

describe('resolveAcl: пустой вход', () => {
  it('без требований и без ошибок — содержимое разрешено', () => {
    expect(resolveAcl({})).toBeNull()
    expect(resolveAcl({ allow: 'guest', authorized: false })).toBeNull()
    expect(resolveAcl({ allow: 'user', authorized: true })).toBeNull()
    expect(resolveAcl({ allow: ['admin'], authorized: true, roles: ['admin'] })).toBeNull()
  })
})

describe('resolveAcl: подсистема авторизации', () => {
  it('выключенный вход — экран auth_disabled, действие «назад»', () => {
    const screen = resolveAcl({ enabled: false })
    expect(screen).toMatchObject({ code: 'auth_disabled', source: 'auth', action: 'back' })
    expect(resolveAcl({ status: 'auth.disabled' })?.code).toBe('auth_disabled')
  })

  it('экран выключенного входа важнее требований субъекта', () => {
    expect(resolveAcl({ enabled: false, allow: 'user', authorized: false })?.code).toBe(
      'auth_disabled',
    )
  })
})

describe('resolveAcl: субъект', () => {
  it('гость у формы «только гостям» и вошедший — экран guest_only', () => {
    expect(resolveAcl({ allow: 'guest', authorized: true })?.code).toBe('guest_only')
  })

  it('гость у закрытого раздела — auth_required с входом', () => {
    expect(resolveAcl({ allow: 'user', authorized: false })).toMatchObject({
      code: 'auth_required',
      action: 'login',
    })
  })

  it('гость с доменным статусом получает статусный экран, а не общий вход', () => {
    expect(resolveAcl({ allow: 'user', authorized: false, status: 'auth.expired' })?.code).toBe(
      'session_expired',
    )
    expect(resolveAcl({ allow: 'user', authorized: false, status: 'auth.blocked' })?.code).toBe(
      'account_blocked',
    )
  })

  it('роли: не хватает — role_forbidden, хватает — null', () => {
    expect(
      resolveAcl({ allow: ['admin', 'editor'], authorized: true, roles: ['reader'] })?.code,
    ).toBe('role_forbidden')
    expect(resolveAcl({ allow: ['admin'], authorized: true })?.code).toBe('role_forbidden')
  })

  it('проверка субъекта идёт раньше доменного экрана', () => {
    // Ограничения вошедшего не должны открываться у гостя: гостю — вход.
    expect(
      resolveAcl({
        allow: 'user',
        authorized: false,
        restrictions: [{ scope: 'posts', reason: 'read-only', at: 0 }],
      })?.code,
    ).toBe('auth_required')
    // Бан гостя не должен открываться у вошедшего: ему — «только гостям».
    expect(
      resolveAcl({
        allow: 'guest',
        authorized: true,
        blocked: { reason: 'spam', untilMs: null },
      })?.code,
    ).toBe('guest_only')
  })
})

describe('resolveAcl: состояния аккаунта', () => {
  it('бан подменяет описание причиной и несёт срок', () => {
    const screen = resolveAcl({
      authorized: true,
      blocked: { reason: 'спам', untilMs: 1_700_000_000_000 },
    })
    expect(screen).toMatchObject({
      code: 'account_blocked',
      description: 'спам',
      untilMs: 1_700_000_000_000,
      tone: 'destructive',
    })
  })

  it('ограничения — списком причин с форматированным сроком', () => {
    const until = new Date('2026-01-02T03:04:05Z').getTime()
    const screen = resolveAcl({
      authorized: true,
      restrictions: [
        { scope: 'posts', reason: 'read-only', at: 0 },
        { scope: 'uploads', reason: 'без загрузок', at: 0, until },
      ],
    })
    expect(screen?.code).toBe('account_restricted')
    expect(screen?.details?.[0]).toBe('read-only')
    expect(screen?.details?.[1]).toContain('без загрузок — до ')
    expect(screen?.details?.[1]).toContain(new Date(until).toLocaleString())
  })

  it('статус без требования субъекта всё равно даёт экран', () => {
    expect(resolveAcl({ authorized: true, status: 'auth.revoked' })).toMatchObject({
      code: 'session_revoked',
      action: 'login',
    })
    expect(resolveAcl({ authorized: true, status: 'auth.delete-pending' })).toMatchObject({
      code: 'account_deleted',
      action: 'restore',
    })
    expect(resolveAcl({ authorized: true, status: 'restrictions' })?.code).toBe(
      'account_restricted',
    )
  })

  it('статусы одной семьи сходятся в один экран', () => {
    for (const status of ['auth.expired', 'auth.token', 'auth.kid-unknown', 'auth.session-unknown'] as const) {
      expect(resolveAcl({ authorized: false, allow: 'user', status })?.code).toBe('session_expired')
    }
    expect(resolveAcl({ authorized: true, status: 'auth.deleted' })?.code).toBe('account_deleted')
  })
})

describe('resolveAcl: срабатывание модели', () => {
  it('каждый код модели имеет экран с действием и тоном', () => {
    const seen: AclScreenCode[] = []
    for (const code of MODEL_CODES) {
      const screen = resolveAcl({ authorized: true, model: code })
      expect(screen, `нет экрана для ${code}`).not.toBeNull()
      expect(screen?.source).toBe('model')
      expect(['neutral', 'warning', 'destructive']).toContain(screen?.tone)
      expect(['login', 'restore', 'back', 'link', 'none']).toContain(screen?.action)
      seen.push(screen!.code)
    }
    // Ни один код не «схлопнулся» в database: отчёт по модели различает причины.
    expect(new Set(seen).size).toBe(MODEL_CODES.length)
  })

  it('payload_too_large — не FailureKind, но `toKitError` его отдаёт', () => {
    expect(resolveAcl({ authorized: true, model: 'payload_too_large' })?.code).toBe(
      'payload_too_large',
    )
  })

  it('forbidden у гостя ведёт на вход, у вошедшего — назад', () => {
    expect(resolveAcl({ authorized: false, model: 'forbidden' })?.action).toBe('login')
    expect(resolveAcl({ authorized: true, model: 'forbidden' })?.action).toBe('back')
  })

  it('неизвестный код модели не маскируется под «нет ошибки»', () => {
    expect(resolveAcl({ authorized: true, model: 'нет-такого' as unknown as FailureKind })?.code).toBe(
      'database',
    )
  })

  it('DbFailure отдаёт ошибки по полям как details', () => {
    const failure = new DbFailure('validation', {
      errors: [
        { field: 'title', code: 'required', message: 'Обязательное поле' },
        { field: 'slug', code: 'format', message: 'Только латиница' },
      ],
    })
    expect(resolveAcl({ authorized: true, model: failure })).toMatchObject({
      code: 'validation',
      details: ['Обязательное поле', 'Только латиница'],
    })
  })

  it('ответ toKitError: `{code, errors:[{message}]}`', () => {
    expect(
      resolveAcl({ authorized: true, model: { code: 'not_found', errors: [{ message: 'нет записи' }] } }),
    ).toMatchObject({ code: 'not_found', details: ['нет записи'] })
  })

  it('ошибка модели не важнее состояния аккаунта', () => {
    expect(
      resolveAcl({ authorized: true, model: 'validation', blocked: { reason: 'бан', untilMs: null } })
        ?.code,
    ).toBe('account_blocked')
  })
})

describe('resolveAcl: действие-ссылка', () => {
  it('schema_pending несёт адрес страницы переноса, а не «назад»', () => {
    const screen = resolveAcl({ authorized: true, model: 'schema_pending' })
    expect(screen).toMatchObject({ action: 'link', href: '/schema' })
  })

  it('адрес не протекает в экраны с другим действием', () => {
    const back = resolveAcl({ authorized: true, model: 'not_found' })
    expect(back?.action).toBe('back')
    expect(back).not.toHaveProperty('href')
  })
})
