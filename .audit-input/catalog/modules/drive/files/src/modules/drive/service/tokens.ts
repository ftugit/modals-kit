/**
 * Пароли приложений для WebDAV (`plan-drive.md` §4.6).
 *
 * Токен — `dv1_<prefix>_<secret>`. В БД лежит только `prefix` и HMAC секрета
 * с серверным ключом: по дампу базы пароль не восстановить, а перебор требует
 * ключа. Проверка сравнивает HMAC за постоянное время.
 */
import type { Database } from '#core/lib/db/index.js'
import { parseBasicAuthorization } from '#core/lib/storage/webdav.js'
import { driveDavToken } from '../schema.js'
import type { DriveActor, DriveResult } from '../types.js'
import { DRIVE_SERVER } from './access.js'
import { driveFail, driveOk } from './result.js'

const TOKEN_RE = /^dv1_([a-f0-9]{16})_([A-Za-z0-9_-]{32,64})$/
const DAY_MS = 86_400_000

const encoder = new TextEncoder()

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function hmacHex(key: string, text: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(text))
  return toHex(new Uint8Array(signature))
}

/** Сравнение без раннего выхода: длины уже равны (hex SHA-256). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let different = 0
  for (let i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return different === 0
}

const dateOf = (value: unknown): Date =>
  value instanceof Date ? value : new Date(typeof value === 'string' ? value : 0)

export interface DriveDavTokenView {
  readonly id: string
  readonly label: string
  readonly prefix: string
  readonly createdAt: Date
  readonly lastUsedAt: Date | null
  readonly revokedAt: Date | null
}

export interface IssuedDriveDavToken extends DriveDavTokenView {
  /** Показывается один раз: в базе только HMAC. */
  readonly token: string
}

async function actorOf(db: Database, authId: string): Promise<DriveActor | null> {
  const { rows } = await db.query<{ permissions: string[] | null }>({
    text: 'SELECT permissions FROM public.user_auth WHERE id = $1 AND deleted_at IS NULL',
    values: [authId],
  })
  if (!rows[0]) return null
  const permissions = Array.isArray(rows[0].permissions) ? rows[0].permissions : []
  return { id: authId, permissions: permissions.filter((p): p is string => typeof p === 'string') }
}

/** Выдать новый пароль приложения. Возвращает открытый токен ровно один раз. */
export async function issueDriveDavToken(
  db: Database,
  actor: DriveActor,
  input: { label: string; secretKey: string },
): Promise<DriveResult<IssuedDriveDavToken>> {
  const label = typeof input.label === 'string' ? input.label.trim() : ''
  if (!label || label.length > 80) return driveFail('drive.dav-label-invalid')
  if (!input.secretKey || input.secretKey.length < 32) return driveFail('drive.dav-disabled')

  const prefix = toHex(crypto.getRandomValues(new Uint8Array(8)))
  const secret = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const token = `dv1_${prefix}_${secret}`
  const secretHash = await hmacHex(input.secretKey, secret)
  const row = await db.resource(driveDavToken).insert(DRIVE_SERVER, {
    auth_id: actor.id,
    label,
    prefix,
    secret_hash: secretHash,
  })
  const view = toView(row as unknown as Record<string, unknown>)
  return driveOk({ ...view, token })
}

/** Список своих паролей (секрет не отдаётся даже владельцу). */
export async function listDriveDavTokens(
  db: Database,
  actor: DriveActor,
): Promise<DriveResult<readonly DriveDavTokenView[]>> {
  const rows = await db.resource(driveDavToken).select(DRIVE_SERVER, {
    filter: { field: 'auth_id', op: 'eq', value: actor.id },
    order: [['created_at', 'desc']],
  })
  return driveOk(
    (rows as unknown as Record<string, unknown>[]).map((row) => toView(row)),
  )
}

/** Отозвать пароль: строка остаётся следом, но вход по ней закрыт. */
export async function revokeDriveDavToken(
  db: Database,
  actor: DriveActor,
  tokenId: string,
): Promise<DriveResult<{ id: string }>> {
  const rows = (await db.resource(driveDavToken).select(DRIVE_SERVER, {
    filter: {
      and: [
        { field: 'id', op: 'eq', value: tokenId },
        { field: 'auth_id', op: 'eq', value: actor.id },
      ],
    },
  })) as unknown as Record<string, unknown>[]
  if (!rows[0]) return driveFail('drive.not-found')
  await db.resource(driveDavToken).update(DRIVE_SERVER, tokenId, {
    revoked_at: new Date().toISOString(),
  })
  return driveOk({ id: tokenId })
}

function toView(row: Record<string, unknown>): DriveDavTokenView {
  return {
    id: String(row.id),
    label: String(row.label ?? ''),
    prefix: String(row.prefix ?? ''),
    createdAt: dateOf(row.created_at),
    lastUsedAt: row.last_used_at == null ? null : dateOf(row.last_used_at),
    revokedAt: row.revoked_at == null ? null : dateOf(row.revoked_at),
  }
}

/**
 * Проверить `Authorization: Basic …` и вернуть аккаунт. Имя пользователя
 * клиент выбирает сам — пароль и есть токен; это привычно для WebDAV-клиентов.
 */
export async function verifyDriveDavToken(
  db: Database,
  authorization: string | null,
  secretKey: string,
): Promise<DriveActor | null> {
  if (!secretKey || secretKey.length < 32) return null
  const credentials = parseBasicAuthorization(authorization)
  if (!credentials) return null
  const match = TOKEN_RE.exec(credentials.password.trim())
  if (!match) return null
  const [, prefix, secret] = match

  const rows = (await db.resource(driveDavToken).select(DRIVE_SERVER, {
    filter: { field: 'prefix', op: 'eq', value: prefix },
  })) as unknown as Record<string, unknown>[]
  const row = rows[0]
  if (!row || row.revoked_at != null) return null

  const expected = await hmacHex(secretKey, secret!)
  if (!timingSafeEqual(expected, String(row.secret_hash ?? ''))) return null

  const actor = await actorOf(db, String(row.auth_id))
  if (!actor) return null
  const lastUsed = row.last_used_at == null ? null : dateOf(row.last_used_at).getTime()
  if (!lastUsed || Date.now() - lastUsed > DAY_MS) {
    await db
      .resource(driveDavToken)
      .update(DRIVE_SERVER, String(row.id), { last_used_at: new Date().toISOString() })
      .catch(() => undefined)
  }
  return actor
}
