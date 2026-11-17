/**
 * Доменный фасад сессий. База не импортирует его: `composition` регистрирует
 * фабрику, а `auth(event)` собирает методы из контекста запроса.
 */
import type { UserDomainContext } from '#modules/user/base/service/gateway.server.js'
import type { UserResult } from '#modules/user/base/service/auth.js'
import type {
  SessionBulkRevokeResult,
  SessionDetail,
  SessionDeviceView,
  SessionRevokeResult,
  SessionsPage,
} from '#modules/user/base/model/types.js'
import {
  listSessionsPage as coreListSessionsPage,
  readSessionDetail as coreReadSessionDetail,
  renameSessionDevice as coreRenameSessionDevice,
  revokeBulkSessions as coreRevokeBulkSessions,
  revokeSessionById as coreRevokeSessionById,
  type ListSessionsPageArgs,
  type RevokeBulkArgs,
} from './sessions.server.js'

declare module '#modules/user/base/service/gateway.server.js' {
  interface UserDomains {
    listSessionsPage(args?: ListSessionsPageArgs): Promise<UserResult<SessionsPage>>
    readSessionDetail(id: string): Promise<UserResult<SessionDetail>>
    renameSessionDevice(id: string, deviceName: string | null): Promise<UserResult<SessionDeviceView>>
    revokeSessionById(id: string, opts?: { hard?: boolean }): Promise<UserResult<SessionRevokeResult>>
    revokeBulkSessions(args: RevokeBulkArgs): Promise<UserResult<SessionBulkRevokeResult>>
  }
}

export function sessionsDomain(ctx: UserDomainContext) {
  return {
    listSessionsPage: async (args?: ListSessionsPageArgs) => {
      const g = await ctx.guard()
      if ('code' in g) return { ok: false as const, fact: g }
      return coreListSessionsPage(ctx.sessionActor(g), args, ctx.sessionDeps())
    },
    readSessionDetail: async (id: string) => {
      const g = await ctx.guard()
      if ('code' in g) return { ok: false as const, fact: g }
      return coreReadSessionDetail(ctx.sessionActor(g), id, ctx.sessionDeps())
    },
    renameSessionDevice: async (id: string, deviceName: string | null) => {
      const g = await ctx.guard()
      if ('code' in g) return { ok: false as const, fact: g }
      return coreRenameSessionDevice(ctx.sessionActor(g), id, deviceName, ctx.sessionDeps())
    },
    revokeSessionById: async (id: string, opts?: { hard?: boolean }) => {
      const g = await ctx.guard()
      if ('code' in g) return { ok: false as const, fact: g }
      return coreRevokeSessionById(ctx.sessionActor(g), id, ctx.sessionDeps(), opts)
    },
    revokeBulkSessions: async (args: RevokeBulkArgs) => {
      const g = await ctx.guard()
      if ('code' in g) return { ok: false as const, fact: g }
      return coreRevokeBulkSessions(ctx.sessionActor(g), args, ctx.sessionDeps())
    },
  }
}
