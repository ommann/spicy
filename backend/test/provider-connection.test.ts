import test from 'node:test';
import assert from 'node:assert/strict';
import { channel } from 'node:diagnostics_channel';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { observeProviderConnection } from '../provider-connection.ts';

const model = { baseUrl: 'https://provider.example/v1' };
const request = { origin: 'https://provider.example', path: '/v1/responses', upgrade: 'websocket' };

test('provider socket closure changes green to yellow without another submission', async () => {
  const states = [];
  const observer = observeProviderConnection(state => states.push(state));
  let peer;
  const server = createServer();
  server.on('upgrade', (request, socket) => {
    peer = socket;
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = `127.0.0.1:${server.address().port}`;
  observer.setModel({ baseUrl: `http://${address}/v1` });
  try {
    const socket = new WebSocket(`ws://${address}/v1/responses`);
    await once(socket, 'open');
    assert.equal(states.at(-1), 'ready');
    const closed = once(socket, 'close');
    peer.destroy();
    await closed;
    assert.equal(states.at(-1), 'socket-lost');
    const reconnected = new WebSocket(`ws://${address}/v1/responses`);
    await once(reconnected, 'open');
    assert.equal(states.at(-1), 'ready');
    const disconnected = once(reconnected, 'close');
    peer.destroy();
    await disconnected;
  } finally {
    observer.close();
    peer?.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});

test('a rejected provider socket connection turns red', async () => {
  const states = [];
  const observer = observeProviderConnection(state => states.push(state));
  const server = createServer();
  server.on('upgrade', (_request, socket) => socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = `127.0.0.1:${server.address().port}`;
  observer.setModel({ baseUrl: `http://${address}/v1` });
  try {
    const socket = new WebSocket(`ws://${address}/v1/responses`);
    await once(socket, 'error');
    assert.equal(states.at(-1), 'error');
  } finally {
    observer.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('connection failure is red; SSE fallback after a socket attempt is yellow', () => {
  const states = [];
  const observer = observeProviderConnection(state => states.push(state));
  try {
    observer.setModel(model);
    channel('undici:request:create').publish({ request });
    channel('undici:request:error').publish({ request, error: { code: 'ECONNREFUSED' } });
    assert.equal(states.at(-1), 'error');
    observer.response(200);
    assert.equal(states.at(-1), 'socket-lost');
  } finally { observer.close(); }
});

test('unrelated traffic and user cancellation do not change provider health', () => {
  const states = [];
  const observer = observeProviderConnection(state => states.push(state));
  try {
    observer.setModel(model);
    channel('undici:request:error').publish({ request: { ...request, origin: 'https://other.example' }, error: { code: 'ECONNREFUSED' } });
    channel('undici:request:error').publish({ request, error: { code: 'UND_ERR_ABORTED' } });
    assert.deepEqual(states, ['ready']);
    observer.response(401);
    assert.equal(states.at(-1), 'error');
    observer.response(200);
    assert.equal(states.at(-1), 'ready');
    observer.close();
    channel('undici:request:error').publish({ request, error: { code: 'ECONNREFUSED' } });
    assert.equal(states.at(-1), 'ready');
  } finally { observer.close(); }
});
