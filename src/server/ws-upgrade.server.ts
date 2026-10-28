// Универсальный серверный мост WebSocket (`Node` / `Vite` / `Vercel` / `Cloudflare`).
//
// Модуль НЕ импортирует `$app/*` и `$env/*`, чтобы его можно было безопасно
// вызывать как из маршрутов SvelteKit (`+server.ts`), так и из `vite.config.ts`
// через `vite-ws.server.ts` до инициализации виртуальных модулей фреймворка.
import { AsyncLocalStorage } from 'node:async_hooks'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { upgradeWebSocket as vercelUpgradeWebSocket } from '@vercel/functions'
import { WebSocketServer, type RawData, type WebSocket as NodeWs } from 'ws'

/** Максимальный размер одного кадра по умолчанию (`512 КБ`: с запасом под сегмент `256 КБ` + заголовок). */
export const DEFAULT_WS_MAX_PAYLOAD = 512 * 1024

/** Единый минимальный интерфейс открытого серверного сокета поверх `ws` и Cloudflare `WebSocket`. */
export interface ServerWsSocket {
  sendText(text: string): void
  sendBinary(bytes: Uint8Array): void
  close(code?: number, reason?: string): void
  onText(listener: (text: string) => void): void
  onBinary(listener: (bytes: Uint8Array) => void): void
  onClose(listener: (code: number, reason: string) => void): void
  onProblem(listener: (cause: unknown) => void): void
}

/** Настройки апгрейда `GET` → `WebSocket`. */
export interface UpgradeWsOptions {
  readonly maxPayload?: number
}

/** Дескриптор сырого Node HTTP `upgrade` (прокидывается из `vite-ws` или кастомного `adapter-node` сервера). */
export interface NodeUpgradeTarget {
  readonly req: IncomingMessage
  readonly socket: Duplex
  readonly head: Buffer
  upgraded?: boolean
}

const nodeUpgradeStorage = new AsyncLocalStorage<NodeUpgradeTarget>()

/** Выполнить обработку запроса с привязанным сокетом Node `upgrade`. */
export function runWithNodeUpgrade<T>(target: NodeUpgradeTarget, fn: () => Promise<T>): Promise<T> {
  return nodeUpgradeStorage.run(target, fn)
}

/** Текущий контекст Node `upgrade`, если запрос пришёл из `httpServer.on('upgrade')`. */
export function currentNodeUpgrade(): NodeUpgradeTarget | undefined {
  return nodeUpgradeStorage.getStore()
}

function rawDataToUint8Array(data: RawData): Uint8Array {
  if (Buffer.isBuffer(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }
  if (Array.isArray(data)) {
    const merged = Buffer.concat(data)
    return new Uint8Array(merged.buffer, merged.byteOffset, merged.byteLength)
  }
  return new Uint8Array(0)
}

/** Обёртка сокета пакета `ws` (`Node`, `Vite`, `Vercel`) в `ServerWsSocket` с ожиданием закрытия. */
export function wrapNodeWebSocket(ws: NodeWs): {
  socket: ServerWsSocket
  closed: Promise<void>
} {
  const textListeners: Array<(text: string) => void> = []
  const binaryListeners: Array<(bytes: Uint8Array) => void> = []
  const closeListeners: Array<(code: number, reason: string) => void> = []
  const problemListeners: Array<(cause: unknown) => void> = []

  ws.on('message', (data: RawData, isBinary: boolean) => {
    const bytes = rawDataToUint8Array(data)
    if (isBinary) {
      for (const fn of binaryListeners) fn(bytes)
    } else {
      const text = new TextDecoder().decode(bytes)
      for (const fn of textListeners) fn(text)
    }
  })

  ws.on('error', (cause) => {
    for (const fn of problemListeners) fn(cause)
  })

  const closed = new Promise<void>((resolve) => {
    if (ws.readyState === ws.CLOSED) {
      resolve()
      return
    }
    ws.on('close', (code: number, reasonBuf: Buffer) => {
      const reason = reasonBuf ? reasonBuf.toString('utf8') : ''
      for (const fn of closeListeners) fn(code, reason)
      resolve()
    })
  })

  const socket: ServerWsSocket = {
    sendText(text: string) {
      if (ws.readyState === ws.OPEN) ws.send(text)
    },
    sendBinary(bytes: Uint8Array) {
      if (ws.readyState === ws.OPEN) ws.send(bytes, { binary: true })
    },
    close(code = 1000, reason = '') {
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
        ws.close(code, reason.slice(0, 120))
      }
    },
    onText(listener) {
      textListeners.push(listener)
    },
    onBinary(listener) {
      binaryListeners.push(listener)
    },
    onClose(listener) {
      closeListeners.push(listener)
    },
    onProblem(listener) {
      problemListeners.push(listener)
    },
  }

  return { socket, closed }
}

interface CloudflareWebSocketLike {
  accept(): void
  send(data: string | ArrayBuffer | Uint8Array): void
  close(code?: number, reason?: string): void
  addEventListener(type: string, listener: (event: Record<string, unknown>) => void): void
}

function wrapCloudflareWebSocket(
  cfWs: CloudflareWebSocketLike,
  maxPayload: number,
): { socket: ServerWsSocket; closed: Promise<void> } {
  const textListeners: Array<(text: string) => void> = []
  const binaryListeners: Array<(bytes: Uint8Array) => void> = []
  const closeListeners: Array<(code: number, reason: string) => void> = []
  const problemListeners: Array<(cause: unknown) => void> = []

  cfWs.addEventListener('message', (ev) => {
    const data = ev.data
    if (typeof data === 'string') {
      if (new TextEncoder().encode(data).byteLength > maxPayload) {
        cfWs.close(1009, 'Message too big')
        return
      }
      for (const fn of textListeners) fn(data)
      return
    }
    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : data instanceof Uint8Array
          ? data
          : new Uint8Array(0)
    if (bytes.byteLength > maxPayload) {
      cfWs.close(1009, 'Message too big')
      return
    }
    for (const fn of binaryListeners) fn(bytes)
  })

  cfWs.addEventListener('error', (ev) => {
    for (const fn of problemListeners) fn(ev)
  })

  const closed = new Promise<void>((resolve) => {
    cfWs.addEventListener('close', (ev) => {
      const code = typeof ev.code === 'number' ? ev.code : 1000
      const reason = typeof ev.reason === 'string' ? ev.reason : ''
      for (const fn of closeListeners) fn(code, reason)
      resolve()
    })
  })

  const socket: ServerWsSocket = {
    sendText(text: string) {
      cfWs.send(text)
    },
    sendBinary(bytes: Uint8Array) {
      cfWs.send(bytes)
    },
    close(code = 1000, reason = '') {
      cfWs.close(code, reason.slice(0, 120))
    },
    onText(listener) {
      textListeners.push(listener)
    },
    onBinary(listener) {
      binaryListeners.push(listener)
    },
    onClose(listener) {
      closeListeners.push(listener)
    },
    onProblem(listener) {
      problemListeners.push(listener)
    },
  }

  return { socket, closed }
}

/** Выполнить прямой апгрейд сырого Node HTTP-сокета (`ws.handleUpgrade`) и дождаться закрытия сессии. */
export async function upgradeNodeTarget(
  target: NodeUpgradeTarget,
  handler: (socket: ServerWsSocket) => void | Promise<void>,
  options: UpgradeWsOptions = {},
): Promise<void> {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: options.maxPayload ?? DEFAULT_WS_MAX_PAYLOAD,
  })
  const rawWs = await new Promise<NodeWs>((resolve, reject) => {
    const onFail = (err: unknown) => reject(err instanceof Error ? err : new Error(String(err)))
    target.socket.once('error', onFail)
    try {
      wss.handleUpgrade(target.req, target.socket, target.head, (upgraded) => {
        target.socket.removeListener('error', onFail)
        target.upgraded = true
        resolve(upgraded)
      })
    } catch (err) {
      target.socket.removeListener('error', onFail)
      reject(err)
    }
  })

  const { socket, closed } = wrapNodeWebSocket(rawWs)
  await Promise.all([Promise.resolve(handler(socket)), closed])
}

/**
 * Платформенный апгрейд HTTP `GET` → `WebSocket` на одном закреплённом инстансе:
 * 1. `Node` / `vite dev` / `vite preview` — через `runWithNodeUpgrade` + `ws`;
 * 2. `Cloudflare Workers` — через нативный `WebSocketPair` (`status: 101`);
 * 3. `Vercel` (Fluid Compute) — через `upgradeWebSocket` из `@vercel/functions`
 *    с удержанием промиса открытым до завершения сессии (`closed`), чтобы инстанс
 *    гарантированно не замораживался до конца приёма файла.
 */
export async function upgradeWs(
  event: { readonly request: Request; readonly platform?: unknown },
  handler: (socket: ServerWsSocket) => void | Promise<void>,
  options: UpgradeWsOptions = {},
): Promise<Response> {
  const upgradeHeader = (event.request.headers.get('upgrade') ?? '').toLowerCase()
  if (upgradeHeader !== 'websocket') {
    return new Response('Expected Upgrade: websocket', {
      status: 426,
      headers: { upgrade: 'websocket', 'cache-control': 'no-store' },
    })
  }

  const maxPayload = options.maxPayload ?? DEFAULT_WS_MAX_PAYLOAD

  // 1. Node / Vite dev / Vite preview / custom adapter-node server
  const nodeTarget = currentNodeUpgrade()
  if (nodeTarget) {
    await upgradeNodeTarget(nodeTarget, handler, { maxPayload })
    return new Response(null, { status: 204 })
  }

  // 2. Cloudflare Workers (global WebSocketPair)
  const WsPairCtor = (globalThis as { WebSocketPair?: new () => Record<number, CloudflareWebSocketLike> })
    .WebSocketPair
  if (typeof WsPairCtor === 'function') {
    const pair = new WsPairCtor()
    const client = pair[0]!
    const server = pair[1]!
    server.accept()
    const { socket, closed } = wrapCloudflareWebSocket(server, maxPayload)
    const sessionTask = Promise.all([Promise.resolve(handler(socket)), closed]).catch((err) => {
      console.error('[ws-upgrade] сбой обработчика Cloudflare WebSocket:', err)
      socket.close(1011, 'Internal failure')
    })
    const cfCtx = (event.platform as { context?: { waitUntil?: (p: Promise<unknown>) => void } } | undefined)
      ?.context
    cfCtx?.waitUntil?.(sessionTask)
    return new Response(null, { status: 101, webSocket: client } as ResponseInit)
  }

  // 3. Vercel Functions (@vercel/functions >= 3.10)
  return vercelUpgradeWebSocket(
    async (rawWs) => {
      const { socket, closed } = wrapNodeWebSocket(rawWs)
      await Promise.all([Promise.resolve(handler(socket)), closed])
    },
    { maxPayload },
  )
}
