import test from 'node:test';
import assert from 'node:assert/strict';
import { LoginBridge } from '../auth.mjs';
import { SettingsManager } from '@earendil-works/pi-coding-agent';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fixture(login, loadSettings) {
  return new LoginBridge(async () => ({
    getProviders: () => [{ id: 'example', name: 'Example', auth: { oauth: { name: 'Example OAuth', login } } }],
    getProvider: id => id === 'example' ? { auth: { oauth: { login } } } : undefined,
    listCredentials: async () => [{ providerId: 'example', type: 'oauth' }],
    login,
  }), loadSettings);
}

test('ChatGPT login receives a persistent installation ID and preserves existing settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spicy-login-device-'));
  const directory = join(root, 'settings');
  const ids = [];
  try {
    await mkdir(directory);
    await writeFile(join(directory, 'settings.json'), JSON.stringify({ compaction: { enabled: false } }));
    for (let attempt = 0; attempt < 2; attempt++) {
      const bridge = fixture(async (_provider, _type, _interaction, options) => {
        assert.equal(options.agentName, 'spicy');
        ids.push(options.getDeviceId());
      }, () => SettingsManager.create(root, directory));
      await bridge.start('example', 'oauth');
      await bridge.flow.done;
      assert.equal(bridge.state().status, 'success');
    }
    assert.match(ids[0], /^[0-9a-f-]{36}$/);
    assert.equal(ids[0], ids[1]);
    const settings = JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8'));
    assert.equal(settings.deviceId, ids[0]);
    assert.deepEqual(settings.compaction, { enabled: false });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('login bridges Pi OAuth navigation and prompts without exposing returned credentials', async () => {
  const bridge = fixture(async (provider, type, interaction) => {
    assert.equal(provider, 'example');
    assert.equal(type, 'oauth');
    interaction.notify({ type: 'auth_url', url: 'https://example.com/oauth' });
    const reply = await interaction.prompt({ type: 'manual_code', message: 'Paste the redirect URL' });
    assert.equal(reply, 'test-code');
    return { access: 'private-access', refresh: 'private-refresh' };
  });
  assert.equal((await bridge.providers())[0].configured, true);
  const state = await bridge.start('example', 'oauth');
  assert.equal(state.status, 'pending');
  assert.equal(state.events[0].url, 'https://example.com/oauth');
  assert.equal(state.prompt.type, 'manual_code');
  assert.throws(() => bridge.reply(state.id, 'old-prompt', 'test-code'), /no longer active/);
  await assert.rejects(bridge.start('example', 'oauth'), /already in progress/);
  bridge.reply(state.id, state.prompt.id, 'test-code');
  await bridge.flow.done;
  assert.equal(bridge.state().status, 'success');
  assert.equal(bridge.state().prompt, undefined);
  assert.doesNotMatch(JSON.stringify(bridge.state()), /private-access|private-refresh|test-code/);
});

test('closing login aborts pending prompts and permits a fresh attempt', async () => {
  const bridge = fixture(async (_provider, _type, interaction) => {
    await interaction.prompt({ type: 'secret', message: 'Enter key' });
  });
  const first = await bridge.start('example', 'oauth');
  await bridge.cancel(first.id);
  assert.equal(bridge.state().status, 'cancelled');
  assert.equal(bridge.state().prompt, undefined);
  const second = await bridge.start('example', 'oauth');
  assert.notEqual(second.id, first.id);
  await assert.rejects(bridge.cancel(first.id), /no longer active/);
  await bridge.cancel(second.id);
});

test('login failures remain visible and unsupported providers never invoke login', async () => {
  let calls = 0;
  const bridge = fixture(async () => { calls++; throw new Error('Sign-in rejected'); });
  await assert.rejects(bridge.start('missing', 'oauth'), /Unknown provider/);
  assert.equal(calls, 0);
  await bridge.start('example', 'oauth');
  await bridge.flow.done;
  assert.equal(bridge.state().status, 'error');
  assert.equal(bridge.state().error, 'Sign-in rejected');
});

test('provider callback completion removes its manual prompt without cancelling login', async () => {
  const manual = new AbortController();
  let finish;
  const bridge = fixture(async (_provider, _type, interaction) => {
    void interaction.prompt({ type: 'manual_code', message: 'Code', signal: manual.signal }).catch(() => {});
    await new Promise(resolve => { finish = resolve; });
  });
  await bridge.start('example', 'oauth');
  manual.abort();
  assert.equal(bridge.state().prompt, undefined);
  assert.equal(bridge.state().status, 'pending');
  finish();
  await bridge.flow.done;
  assert.equal(bridge.state().status, 'success');
});
