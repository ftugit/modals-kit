import { PassThrough } from 'node:stream';

/**
 * Isolate adapter-node's web-stream cancel from the response socket. A cancelled
 * synthetic readable closes immediately (so code awaiting its close can finish),
 * while the original connection is closed only after the response has flushed.
 */
export function bridgeIncomingRequest(req, res) {
  const body = new PassThrough();
  body.on('error', () => {});
  let cancelled = false;
  const view = new Proxy(req, {
    get(target, key) {
      if (key in body && key !== 'constructor') {
        const value = Reflect.get(body, key, body);
        return typeof value === 'function' ? value.bind(body) : value;
      }
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const onAborted = () => { if (!body.destroyed) body.destroy(new Error('Request aborted')); };
  const onError = (error) => { if (!body.destroyed) body.destroy(error); };
  req.on('aborted', onAborted);
  req.on('error', onError);
  body.once('close', () => {
    if (!body.readableEnded && !req.readableEnded && !res.writableEnded && !res.destroyed) {
      cancelled = true;
      req.unpipe(body);
      req.pause();
      if (!res.headersSent) res.setHeader('connection', 'close');
      res.once('finish', () => {
        const socket = req.socket;
        if (!socket || socket.destroyed) return;
        socket.setTimeout(2_000, () => socket.destroy());
        socket.end();
      });
    }
  });
  res.once('close', () => {
    req.removeListener('aborted', onAborted);
    req.removeListener('error', onError);
    if (cancelled && !req.destroyed) req.destroy();
    if (!body.destroyed) body.destroy();
  });
  req.pipe(body);
  return view;
}
