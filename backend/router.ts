import type { AgentRegistry } from './agents.ts';
import type { LoginBridge } from './auth.ts';
import { timingSafeEqual } from 'node:crypto';
import { os as rpc, ORPCError } from '@orpc/server';
import { agentEvents } from './agent-events.ts';
import { createOperations, OperationError } from './operations.ts';
import { agentInput, emptyInput, sessionsInput, sessionInput, eventsInput, createAgentInput, startInput, loginInput, loginReplyInput, loginCancelInput, uiInput, attachmentsInput, branchInput, commandInput } from './inputs.ts';

export function createRouter({ agents, login, cwd, managed, token, signal: shutdownSignal }: { agents: AgentRegistry; login: LoginBridge; cwd: string; managed: string; token: string; signal?: AbortSignal }) {
  const operations = createOperations({ agents, cwd, managed });
  const procedure = rpc.$context<{ headers: Headers }>().use(async ({ next }) => {
    try { return await next(); }
    catch (error) {
      if (error instanceof ORPCError) throw error;
      const code = error instanceof OperationError && error.reason === 'not-found' ? 'NOT_FOUND'
        : error instanceof OperationError && error.reason === 'conflict' ? 'CONFLICT' : 'BAD_REQUEST';
      throw new ORPCError(code, { message: error instanceof Error ? error.message : String(error), cause: error });
    }
  });
  const mutation = procedure.use(async ({ context, next }) => {
    const value = context.headers.get('x-spicy-token');
    const actual = Buffer.from(value || '');
    const expected = Buffer.from(token);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ORPCError('FORBIDDEN', { message: 'Invalid token' });
    return next();
  });
  return {
    info: procedure.input(agentInput).handler(({ input }) => ({ token, ...operations.info(input) })),
    sessions: procedure.input(sessionsInput).handler(({ input }) => operations.sessions(input)),
    session: procedure.input(sessionInput).handler(({ input }) => operations.session(input)),
    agents: {
      list: procedure.input(emptyInput).handler(() => operations.listAgents()),
      create: mutation.input(createAgentInput).handler(({ input }) => operations.createAgent(input)),
    },
    events: procedure.input(eventsInput).handler(async function* ({ input, signal }) {
      const selected = operations.eventAgents([...new Set(input.agentIds)]);
      if (!selected) { yield { type: 'reset' }; return; }
      const lifetime = shutdownSignal ? AbortSignal.any([shutdownSignal, ...(signal ? [signal] : [])]) : signal;
      try { yield* agentEvents(selected, lifetime); }
      catch (error) {
        if (!shutdownSignal?.aborted || error !== shutdownSignal.reason) throw error;
      }
    }),
    auth: {
      codexUsage: procedure.input(emptyInput).handler(({ signal }) => login.codexUsage(signal)),
      providers: procedure.input(emptyInput).handler(() => login.providers()),
      state: procedure.input(emptyInput).handler(() => login.state()),
      login: mutation.input(loginInput).handler(({ input }) => login.start(input.providerId, input.type)),
      reply: mutation.input(loginReplyInput).handler(({ input }) => login.reply(input.id, input.promptId, input.value)),
      cancel: mutation.input(loginCancelInput).handler(({ input }) => login.cancel(input.id)),
    },
    attachments: mutation.input(attachmentsInput).handler(({ input }) => operations.attachments(input)),
    ui: mutation.input(uiInput).handler(({ input }) => operations.ui(input)),
    stop: mutation.input(agentInput).handler(({ input }) => operations.stop(input)),
    start: mutation.input(startInput).handler(({ input }) => operations.start(input)),
    branch: mutation.input(branchInput).handler(({ input }) => operations.branch(input)),
    continue: mutation.input(branchInput).handler(({ input }) => operations.continue(input)),
    command: mutation.input(commandInput).handler(({ input }) => operations.command(input)),
  };
}
