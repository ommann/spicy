import test from 'node:test';
import assert from 'node:assert/strict';

test('native oRPC calls read the current token and honor cancellation', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests = [];
  let waitForAbort = false;
  globalThis.window = { location: { origin: 'http://spicy.test' } };
  globalThis.fetch = async request => {
    requests.push(request);
    if (waitForAbort) {
      return new Promise((resolve, reject) => {
        if (request.signal.aborted) reject(request.signal.reason);
        else request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
      });
    }
    return new Response(JSON.stringify({ json: {} }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { api } = await import('../src/api.ts');
    let token = 'first';
    const controller = new AbortController();
    const options = { signal: controller.signal, context: { get token() { return token; } } };
    await api.command({ agentId: 'agent-a', type: 'abort' }, options);
    token = 'refreshed';
    await api.stop({ agentId: 'agent-b' }, options);
    assert.deepEqual(requests.map(request => request.headers.get('X-Spicy-Token')), ['first', 'refreshed']);
    assert.deepEqual(requests.map(request => new URL(request.url).pathname), ['/rpc/command', '/rpc/stop']);
    assert.equal((await requests[0].json()).json.agentId, 'agent-a');
    assert.equal((await requests[1].json()).json.agentId, 'agent-b');
    waitForAbort = true;
    const pending = api.auth.cancel({}, options);
    controller.abort();
    await assert.rejects(pending, error => error.name === 'AbortError');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
