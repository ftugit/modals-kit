import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { getRequest } from '@sveltejs/kit/node';
import { bridgeIncomingRequest } from './node-request-bridge.mjs';

async function withServer(handler, run) {
  const server = http.createServer((req, res) => { Promise.resolve(handler(bridgeIncomingRequest(req, res), res)).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(server.address().port); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}
function request(port, mode = 'complete') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/', headers: { 'transfer-encoding': 'chunked' } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString(), headers: res.headers }));
    });
    req.setTimeout(3000, () => req.destroy(new Error('client timed out')));
    req.on('error', reject); req.write(Buffer.alloc(4096));
    if (mode === 'complete') req.end();
  });
}

test('cancelled web body closes the synthetic request before the handler response', async () => {
  await withServer(async (req, res) => {
    const web = getRequest({ request: req, response: res, base: 'http://localhost' });
    const reader = web.body.getReader();
    await reader.read();
    const closed = new Promise((resolve) => req.once('close', resolve));
    await reader.cancel();
    await closed;
    res.writeHead(413); res.end('too large');
  }, async (port) => {
    const response = await request(port, 'unfinished');
    assert.equal(response.status, 413);
    assert.equal(response.text, 'too large');
    assert.equal(response.headers.connection, 'close');
  });
});

test('ordinary completed request can be read and answered', async () => {
  await withServer(async (req, res) => {
    const web = getRequest({ request: req, response: res, base: 'http://localhost' });
    const b = await web.arrayBuffer();
    res.writeHead(200); res.end(String(b.byteLength));
  }, async (port) => {
    const response = await request(port);
    assert.equal(response.status, 200); assert.equal(response.text, '4096');
  });
});

test('completed bodies preserve keep-alive across two requests on one socket', async () => {
  const connections = new Set();
  await withServer(async (req, res) => {
    connections.add(req.socket.remotePort);
    const web = getRequest({ request: req, response: res, base: 'http://localhost' });
    res.end(await web.text());
  }, async (port) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const send = (body) => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', agent }, (res) => {
        const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks).toString()));
      });
      req.on('error', reject); req.end(body);
    });
    try { assert.equal(await send('first'), 'first'); assert.equal(await send('second'), 'second'); assert.equal(connections.size, 1); }
    finally { agent.destroy(); }
  });
});

test('client abort rejects an in-progress body read without killing subsequent requests', async () => {
  let abortedResolve;
  const observed = new Promise((resolve) => { abortedResolve = resolve; });
  await withServer(async (req, res) => {
    const web = getRequest({ request: req, response: res, base: 'http://localhost' });
    try { await web.arrayBuffer(); res.end('ok'); }
    catch (error) { abortedResolve(error); if (!res.destroyed) res.destroy(); }
  }, async (port) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', headers: { 'transfer-encoding': 'chunked' } });
    req.on('error', () => {});
    req.write('partial');
    await new Promise((resolve) => setTimeout(resolve, 30));
    req.destroy();
    const error = await Promise.race([observed, new Promise((_, reject) => setTimeout(() => reject(new Error('abort not observed')), 3000))]);
    assert.ok(error instanceof Error);
    const next = await request(port);
    assert.equal(next.status, 200);
  });
});
