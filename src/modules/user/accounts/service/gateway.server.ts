/** Доменный фасад аккаунтов: список seed-юзеров, срез и наборное удаление. */
import type { UserDomainContext } from '#modules/user/base/service/gateway.server.js'
import type { UserResult } from '#modules/user/base/service/auth.js'
import type { SeedUsersPage } from '#modules/user/base/model/types.js'
import { listSeedUsers as coreListSeedUsers, type ListSeedUsersArgs } from './accounts.js'
import {
  deleteAccountsBySet as coreDeleteAccountsBySet,
  resolveAccountSlice as coreResolveAccountSlice,
  type AccountsSlice,
  type DeleteAccountsArgs,
  type DeleteAccountsResult,
} from './accounts-admin.js'

declare module '#modules/user/base/service/gateway.server.js' {
  interface UserDomains {
    /** Порция списка seed-юзеров (нужны `admin` или `account.read`). */
    listSeedUsers(args?: ListSeedUsersArgs): Promise<UserResult<SeedUsersPage>>
    /** Набор аккаунтов по срезу списка: `id`/`ids`/срез, одна форма. */
    resolveAccountSlice(args?: AccountsSlice): Promise<UserResult<string[]>>
    /** Мягко удалить набор аккаунтов («удаление запрошено»). */
    deleteAccountsBySet(args: DeleteAccountsArgs): Promise<UserResult<DeleteAccountsResult>>
  }
}

export function accountsDomain(ctx: UserDomainContext) {
  const { ports } = ctx
  return {
    listSeedUsers: async (args?: ListSeedUsersArgs) =>
      coreListSeedUsers(ports, await ctx.freshAccess(), args),
    resolveAccountSlice: async (args?: AccountsSlice) =>
      coreResolveAccountSlice(ports, await ctx.freshAccess(), args ?? {}),
    deleteAccountsBySet: async (args: DeleteAccountsArgs) =>
      coreDeleteAccountsBySet(ports, await ctx.freshAccess(), args),
  }
}
