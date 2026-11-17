/**
 * Адаптер порта профиля: единственное место, где домен профиля читает/пишет
 * свою модель под контекстом вызывающего. База держит только фабрику-провайдер
 * (composition регистрирует её), поэтому без субмодуля профиль — no-op.
 */
import { db } from '#core/server/db.server.js'
import { removeManagedAvatarByUrl } from '#core/server/app-storage.server.js'
import type { DataContext } from '#core/lib/db/index.js'
import { profile as profileRes } from '../model/profile.schema.js'
import type { ProfileListView, ProfileView } from '../model/types.js'

const ms = (v: unknown): number | null => (v ? new Date(String(v)).getTime() : null)

export function createProfilesAdapter() {
  const api = () => db.resource(profileRes)
  // Контекст приходит от ядра: чтение и правка — владелец, создание и смерть
  // аккаунта — сервер. Адаптер не выбирает права сам.
  const byAuth = async (
    ctx: DataContext,
    authId: string,
    fields?: readonly string[],
  ): Promise<Record<string, unknown> | undefined> => {
    const rows = await api().select(ctx, {
      filter: { field: 'auth_id', op: 'eq', value: authId },
      ...(fields ? { fields: [...fields] } : {}),
    })
    return rows[0] as unknown as Record<string, unknown> | undefined
  }
  const viewOf = (r: Record<string, unknown>): ProfileView => ({
    id: String(r.id),
    authId: String(r.auth_id),
    nickname: (r.nickname as string | null) ?? null,
    avatarUrl: (r.avatar_url as string | null) ?? null,
    createdAt: ms(r.created_at) ?? Date.now(),
    updatedAt: ms(r.updated_at) ?? Date.now(),
  })
  const listViewOf = (r: Record<string, unknown>): ProfileListView => ({
    id: String(r.auth_id),
    nickname: (r.nickname as string | null) ?? null,
    avatarUrl: (r.avatar_url as string | null) ?? null,
    createdAt: ms(r.created_at) ?? Date.now(),
  })
  return {
    async create(ctx: DataContext, authId: string, patch: { nickname?: string; avatarUrl?: string }): Promise<void> {
      await api().insert(ctx, {
        auth_id: authId,
        ...(patch.nickname !== undefined ? { nickname: patch.nickname } : {}),
        ...(patch.avatarUrl !== undefined ? { avatar_url: patch.avatarUrl } : {}),
      })
    },
    async get(ctx: DataContext, authId: string, fields?: readonly string[]): Promise<ProfileView | undefined> {
      const row = await byAuth(ctx, authId, fields)
      return row ? viewOf(row) : undefined
    },
    async listPage(ctx: DataContext, args: { page: number; pageSize: number; search?: string }): Promise<{ rows: ProfileListView[]; total: number }> {
      const page = Math.max(1, Math.trunc(args.page ?? 1) || 1)
      const pageSize = Math.max(1, Math.trunc(args.pageSize ?? 30) || 30)
      const q = (args.search ?? '').trim()
      const filter = q ? { field: 'nickname', op: 'icontains' as const, value: q } : undefined
      const slice = filter ? { filter } : {}
      const [rows, total] = await Promise.all([
        api().select(ctx, {
          page,
          limit: pageSize,
          order: [['created_at', 'desc']],
          fields: ['auth_id', 'nickname', 'avatar_url', 'created_at'],
          ...slice,
        } as never),
        api().count(ctx, slice as never),
      ])
      return { rows: (rows as unknown as Record<string, unknown>[]).map((r) => listViewOf(r)), total }
    },
    async update(ctx: DataContext, authId: string, patch: { nickname?: string; avatarUrl?: string | null }): Promise<void> {
      const row = await byAuth(ctx, authId)
      if (!row) return
      const prevAvatarUrl = (row.avatar_url as string | null) ?? null
      await api().update(ctx, row.id, {
        ...(patch.nickname !== undefined ? { nickname: patch.nickname } : {}),
        ...(patch.avatarUrl !== undefined ? { avatar_url: patch.avatarUrl } : {}),
      })
      if (patch.avatarUrl !== undefined && prevAvatarUrl && prevAvatarUrl !== patch.avatarUrl) {
        await removeManagedAvatarByUrl(prevAvatarUrl)
      }
    },
    async remove(ctx: DataContext, authId: string): Promise<void> {
      const row = await byAuth(ctx, authId)
      if (!row) return
      const prevAvatarUrl = (row.avatar_url as string | null) ?? null
      await api().delete(ctx, row.id, { hard: true })
      if (prevAvatarUrl) await removeManagedAvatarByUrl(prevAvatarUrl)
    },
  }
}
