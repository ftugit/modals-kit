// Мост HTTP `upgrade` для `vite dev`, `vite preview` и standalone `node:http` серверов.
//
// Пропускает рукопожатие целевого WS-пути через штатный конвейер middleware SvelteKit
// (`hooks.server.ts` → `dbHandle` → маршрут `+server.ts`), сохраняя реальный `Origin`,
// `Cookie` и IP клиента, при этом изолируя синтетический `ServerResponse` от живого
// TCP-сокета WebSocket (`wss.handleUpgrade` пишет `101 Switching Protocols` напрямую).
import { IncomingMessage, ServerResponse, type Server as HttpServer } from 'node:http'
import { PassThrough, type Duplex } from 'node:stream'
import type { Connect, Plugin } from 'vite'
import { runWithNodeUpgrade, type NodeUpgradeTarget } from './ws-upgrade.server.js'

const ATTACHED_SERVERS = new WeakSet<object>()

function isTargetWsPath(rawUrl: string | undefined, paths: readonly string[]): boolean {
  if (!rawUrl) return false
  try {
    const { pathname } = new URL(rawUrl, 'http://ws.local')
    return paths.includes(pathname)
  } catch {
    return false
  }
}

function rejectRawSocket(socket: Duplex, status: number, text: string): void {
  if (socket.destroyed || !socket.writable) return
  socket.write(
    `HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  )
  socket.destroy()
}

/**
 * Подключить перехват `upgrade` на Node HTTP-сервер с прогоном через Connect/SvelteKit handler.
 */
export function attachNodeWsUpgrade(
  httpServer: HttpServer | null | undefined,
  dispatch: (req: IncomingMessage, res: ServerResponse) => void,
  paths: readonly string[],
): void {
  if (!httpServer || ATTACHED_SERVERS.has(httpServer)) return
  ATTACHED_SERVERS.add(httpServer)

  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    // Не трогаем Vite HMR и чужие пути сокетов
    const protocol = String(req.headers['sec-websocket-protocol'] ?? '')
    if (protocol.includes('vite-hmr') || !isTargetWsPath(req.url, paths)) {
      return
    }

    const dummySocket = new PassThrough() as unknown as Duplex
    dummySocket.resume()
    dummySocket.on('error', () => undefined)
    // Сохраняем remoteAddress для `event.getClientAddress()` в SvelteKit
    const realAddr = (req.socket as { remoteAddress?: string } | undefined)?.remoteAddress ?? '127.0.0.1'
    Object.defineProperty(dummySocket, 'remoteAddress', { value: realAddr, configurable: true })

    const synthReq = new IncomingMessage(dummySocket as never)
    synthReq.method = 'GET'
    synthReq.url = req.url ?? paths[0] ?? '/'
    synthReq.headers = { ...req.headers }
    synthReq.push(null)

    const dummyRes = new ServerResponse(synthReq)
    dummyRes.assignSocket(dummySocket as never)

    const target: NodeUpgradeTarget = { req, socket, head, upgraded: false }

    dummyRes.on('finish', () => {
      if (!target.upgraded && !socket.destroyed) {
        const code = dummyRes.statusCode >= 400 ? dummyRes.statusCode : 400
        rejectRawSocket(socket, code, dummyRes.statusMessage || 'Upgrade Rejected')
      }
      dummySocket.destroy()
    })

    void runWithNodeUpgrade(target, async () => {
      dispatch(synthReq, dummyRes)
    }).catch((err) => {
      console.error('[vite-ws] сбой при апгрейде WebSocket:', err)
      if (!target.upgraded) rejectRawSocket(socket, 500, 'Internal Server Error')
      dummySocket.destroy()
    })
  })
}

/** Vite-плагин поддержки серверных WebSocket-маршрутов в `vite dev` и `vite preview`. */
export function sveltekitWsPlugin(paths: readonly string[] = ['/api/form-upload']): Plugin {
  return {
    name: 'modals-kit-ws-upgrade',
    configureServer(server) {
      attachNodeWsUpgrade(
        server.httpServer as HttpServer | null,
        (req, res) => (server.middlewares as Connect.Server)(req, res),
        paths,
      )
    },
    configurePreviewServer(server) {
      attachNodeWsUpgrade(
        server.httpServer as HttpServer | null,
        (req, res) => (server.middlewares as Connect.Server)(req, res),
        paths,
      )
    },
  }
}
