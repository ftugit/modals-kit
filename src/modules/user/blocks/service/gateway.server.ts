/** Доменный фасад блокировок: список, карточка, создание/снятие и наборы. */
import type { UserDomainContext } from '#modules/user/base/service/gateway.server.js'
import type { UserResult } from '#modules/user/base/service/auth.js'
import type {
  BlockDetailView,
  BlocksPage,
} from '#modules/user/base/model/types.js'
import {
  addBlock as coreAddBlock,
  blockCreateMeta as coreBlockCreateMeta,
  deleteBlock as coreDeleteBlock,
  liftBlock as coreLiftBlock,
  listBlocksPage as coreListBlocksPage,
  readBlockDetail as coreReadBlockDetail,
  saveBlock as coreSaveBlock,
  type ListBlocksPageArgs,
} from '#modules/user/base/service/blocks.js'
import {
  deleteBlocksBySet as coreDeleteBlocksBySet,
  liftBlocksBySet as coreLiftBlocksBySet,
  resolveBlockSlice as coreResolveBlockSlice,
  type BlocksBulkArgs,
  type BlocksBulkResult,
  type BlocksSlice,
} from './blocks-admin.js'

declare module '#modules/user/base/service/gateway.server.js' {
  interface UserDomains {
    addBlock(args: { targetId: string; scope: string; reason: string; forever?: boolean; until?: number | null }): Promise<UserResult<{ id: string }>>
    liftBlock(args: { targetId: string; blockId: string }): Promise<UserResult<{ id: string }>>
    resolveBlockSlice(args?: BlocksSlice): Promise<UserResult<string[]>>
    liftBlocksBySet(args: BlocksBulkArgs): Promise<UserResult<BlocksBulkResult>>
    deleteBlocksBySet(args: BlocksBulkArgs): Promise<UserResult<BlocksBulkResult>>
    listBlocksPage(args?: ListBlocksPageArgs): Promise<UserResult<BlocksPage>>
    blockCreateMeta(targetId?: string | null): Promise<
      UserResult<{
        uid: string | null
        canCreate: boolean
        canPickUsers: boolean
        assignableScopes: readonly string[]
        holdSeconds: number
      }>
    >
    readBlockDetail(args: { blockId: string; expectedUid?: string | null }): Promise<UserResult<BlockDetailView>>
    saveBlock(args: {
      blockId?: string | null
      targetId?: string | null
      targetIds?: readonly string[]
      scope?: string
      reason?: string
      forever?: boolean
      until?: number | null
      liftNow?: boolean
    }): Promise<UserResult<{ id: string; targetId: string; targetIds?: readonly string[]; count?: number }>>
    deleteBlock(args: {
      blockId: string
      targetId?: string | null
      hard?: boolean
    }): Promise<UserResult<{ id: string; targetId: string; hard: boolean }>>
  }
}

export function blocksDomain(ctx: UserDomainContext) {
  const { ports } = ctx
  const fresh = () => ctx.freshAccess()
  return {
    addBlock: async (args: Parameters<typeof coreAddBlock>[2]) => coreAddBlock(ports, await fresh(), args),
    liftBlock: async (args: Parameters<typeof coreLiftBlock>[2]) => coreLiftBlock(ports, await fresh(), args),
    resolveBlockSlice: async (args?: BlocksSlice) => coreResolveBlockSlice(ports, await fresh(), args ?? {}),
    liftBlocksBySet: async (args: BlocksBulkArgs) => coreLiftBlocksBySet(ports, await fresh(), args),
    deleteBlocksBySet: async (args: BlocksBulkArgs) => coreDeleteBlocksBySet(ports, await fresh(), args),
    listBlocksPage: async (args?: ListBlocksPageArgs) => coreListBlocksPage(ports, await fresh(), args),
    blockCreateMeta: async (targetId?: string | null) => coreBlockCreateMeta(ports, await fresh(), targetId),
    readBlockDetail: async (args: Parameters<typeof coreReadBlockDetail>[2]) =>
      coreReadBlockDetail(ports, await fresh(), args),
    saveBlock: async (args: Parameters<typeof coreSaveBlock>[2]) => coreSaveBlock(ports, await fresh(), args),
    deleteBlock: async (args: Parameters<typeof coreDeleteBlock>[2]) => coreDeleteBlock(ports, await fresh(), args),
  }
}
