/** Доменный фасад профиля: чтение, публичная проекция, правка и удаление. */
import type { UserDomainContext } from '#modules/user/base/service/gateway.server.js'
import type { UserResult } from '#modules/user/base/service/auth.js'
import type {
  ProfileRead,
  ProfileView,
  PublicProfileView,
} from '#modules/user/base/model/types.js'
import type { ProfilesPage } from './profile.js'
import {
  deleteProfile as coreDeleteProfile,
  listProfiles as coreListProfiles,
  profile as coreProfile,
  publicProfile as corePublicProfile,
  setVisibility as coreSetVisibility,
  updateProfile as coreUpdateProfile,
} from './profile.js'

declare module '#modules/user/base/service/gateway.server.js' {
  interface UserDomains {
    /** Свой профиль; `subject` — чужой (нужны права `profile.read`/`admin`). */
    /** Порция листа профилей (публичный; видимость — по модели профиля). */
    listProfiles(args?: { page?: number; pageSize?: number; search?: string }): Promise<UserResult<ProfilesPage>>
    profile(subject?: string): Promise<UserResult<ProfileRead>>
    /** Публичный показ чужого профиля проекцией (гость допустим). */
    publicProfile(subject: string): Promise<UserResult<PublicProfileView>>
    /** Сменить видимость своего профиля (значение = умолчание строку не плодит). */
    setProfileVisibility(level: string): Promise<UserResult<{ stored: boolean }>>
    /** Сохранить свой профиль; `subject` — чужой (право `profile.edit`/`admin`). */
    updateProfile(
      args: { nickname?: string; avatarUrl?: string | null },
      subject?: string,
    ): Promise<UserResult<ProfileView>>
    /** Удалить профиль цели; `withSeed` — и seed-аккаунт. */
    deleteProfile(args: { withSeed?: boolean }, subject?: string): Promise<UserResult<{ selfSeedDeleted: boolean; selfProfileDeleted: boolean }>>
  }
}

export function profileDomain(ctx: UserDomainContext) {
  const { ports } = ctx
  return {
    listProfiles: async (args?: { page?: number; pageSize?: number; search?: string }) =>
      coreListProfiles(ports, await ctx.freshAccess(), args ?? {}),
    profile: async (subject?: string) => coreProfile(ports, await ctx.freshAccess(), subject),
    publicProfile: async (subject: string) => corePublicProfile(ports, ctx.accessToken(), subject),
    setProfileVisibility: async (level: string) =>
      coreSetVisibility(ports, await ctx.freshAccess(), level),
    updateProfile: async (args: { nickname?: string; avatarUrl?: string | null }, subject?: string) =>
      coreUpdateProfile(ports, await ctx.freshAccess(), args, subject),
    deleteProfile: async (args: { withSeed?: boolean }, subject?: string) => {
      const token = await ctx.freshAccess()
      const r = await coreDeleteProfile(ports, token, subject, args)
      if (!r.ok) return r
      const payload = token ? await ports.seal.unseal(token) : null
      const self = payload && 'sub' in payload ? payload.sub : undefined
      const isSelf = Boolean(self && (subject ?? self) === self)
      const selfSeedDeleted = isSelf && Boolean(args.withSeed)
      if (selfSeedDeleted) ctx.clearCookies()
      return { ok: true as const, value: { selfSeedDeleted, selfProfileDeleted: isSelf && !args.withSeed } }
    },
  }
}
