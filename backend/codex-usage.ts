import type { ModelRuntime } from '@earendil-works/pi-coding-agent';

// Mirrors Codex's passive ChatGPT usage request (no Reserve opt-in):
// https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs
export async function getCodexUsage(runtime: ModelRuntime, { fetch: request = globalThis.fetch, signal, capture }: { fetch?: typeof globalThis.fetch; signal?: AbortSignal; capture?: (account: string, usage: unknown) => void } = {}) {
  const provider = 'openai-codex';
  const check = await runtime.checkAuth(provider);
  if (check?.type !== 'oauth') return null;
  // Let Pi resolve/refresh credentials; never expose them to the caller.
  const resolved = await runtime.getAuth(provider);
  const token = resolved?.auth?.apiKey;
  if (!token) throw new Error('Codex OAuth credentials unavailable');
  let accountId;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    accountId = payload['https://api.openai.com/auth']?.chatgpt_account_id;
  } catch { /* Report a safe error without including credentials. */ }
  if (typeof accountId !== 'string' || !accountId) throw new Error('Codex account ID unavailable');
  const response = await request('https://chatgpt.com/backend-api/wham/usage', {
    headers: { Authorization: `Bearer ${token}`, 'ChatGPT-Account-Id': accountId },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Codex usage request failed (${response.status})`);
  const usage = await response.json();
  capture?.(accountId, usage);
  return usage;
}
