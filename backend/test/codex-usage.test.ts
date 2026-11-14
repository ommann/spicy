import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCodexUsage } from '../codex-usage.ts';

const token = `x.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'account' } })).toString('base64url')}.x`;
const runtime = {
  checkAuth: async () => ({ type: 'oauth' }),
  getAuth: async () => ({ auth: { apiKey: token } }),
};

test('fetches account usage like Codex without opting into Reserve', async () => {
  const usage = { rate_limit: { primary_window: { used_percent: 42, reset_at: 123 } } };
  let captured;
  const result = await getCodexUsage(runtime, { capture: (account, value) => { captured = { account, value }; }, fetch: async (url, options) => {
    assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage');
    assert.deepEqual(options.headers, { Authorization: `Bearer ${token}`, 'ChatGPT-Account-Id': 'account' });
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    return Response.json(usage);
  } });
  assert.deepEqual(result, usage);
  assert.deepEqual(captured, { account: 'account', value: usage });
});

test('does not request usage for API-key or missing authentication', async () => {
  for (const check of [undefined, { type: 'api_key' }]) {
    assert.equal(await getCodexUsage({ checkAuth: async () => check }, {
      fetch: () => assert.fail('must not fetch'),
    }), null);
  }
});

test('HTTP errors do not leak response bodies or credentials', async () => {
  await assert.rejects(getCodexUsage(runtime, {
    fetch: async () => new Response(token, { status: 401 }),
  }), { message: 'Codex usage request failed (401)' });
});

test('invalid tokens fail before making a request', async () => {
  await assert.rejects(getCodexUsage({ ...runtime, getAuth: async () => ({ auth: { apiKey: 'invalid' } }) }, {
    fetch: () => assert.fail('must not fetch'),
  }), { message: 'Codex account ID unavailable' });
});
