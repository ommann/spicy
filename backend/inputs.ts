import path from 'node:path';
import { z } from 'zod';
import type { SystemPromptPart } from '../packages/coding-agent/src/core/system-prompt-document';

const id = z.string().min(1);
const agent = { agentId: id.optional() };
export const agentInput = z.strictObject(agent).default({});
export const emptyInput = z.strictObject({}).default({});
export const sessionsInput = z.strictObject({ ...agent, scope: z.enum(['all', 'cwd']).optional() }).default({});
export const sessionInput = z.strictObject({ ...agent, id });
export const eventsInput = z.strictObject({ agentIds: z.array(id).min(1).max(256) });

const part: z.ZodType<SystemPromptPart, SystemPromptPart> = z.lazy(() => z.strictObject({
  id, label: z.string(), source: z.string(), section: z.string().optional(),
  verbatim: z.boolean().optional(), text: z.string().optional(), defaultIncluded: z.boolean().optional(),
  inline: z.boolean().optional(), children: z.array(part).optional(), separator: z.string().optional(),
  prefix: z.string().optional(), suffix: z.string().optional(),
}));
const builder = {
  document: z.strictObject({ version: z.literal(1), parts: z.array(part), content: part.optional(), forced: part.optional() }),
  excludedIds: z.array(id),
};
const systemPrompt = z.strictObject({
  choice: z.string().optional(), ignored: z.array(id).optional(),
  selected: z.strictObject({
    key: id, content: z.string(), sections: z.record(z.string(), z.string()),
    promptBuilder: z.strictObject(builder).optional(),
  }).optional(),
});
const image = z.strictObject({ type: z.literal('image'), data: z.string().min(1).regex(/^[A-Za-z0-9+/]*={0,2}$/), mimeType: z.string().min(1) });
const prompt = { message: z.string(), images: z.array(image).optional(), systemPrompt: systemPrompt.optional() };
export const branchInput = z.strictObject({ ...agent, entryId: id, ...prompt })
  .refine(value => value.message.trim().length > 0 || Boolean(value.images?.length), { message: 'Message is empty', path: ['message'] });

const create = {
  ...agent, cwd: z.string().refine(value => path.isAbsolute(value), 'cwd must be an absolute path').optional(),
  sourceAgentId: id.optional(), sessionId: id.optional(), entryId: id.optional(),
};
export const createAgentInput = z.union([
  z.strictObject(create)
    .refine(value => !(value.sourceAgentId && value.sessionId), { message: 'Choose sourceAgentId or sessionId, not both' })
    .refine(value => !value.entryId || Boolean(value.sourceAgentId || value.sessionId), { message: 'entryId requires sourceAgentId or sessionId', path: ['entryId'] }),
  z.strictObject({ ...agent, openSessionId: id }),
  z.strictObject({ ...agent, sessionUrlId: z.string().regex(/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/) }),
]);
export const startInput = z.strictObject({ ...agent, sessionId: id.optional() }).default({});
export const loginInput = z.strictObject({ ...agent, providerId: id, type: z.enum(['oauth', 'api_key']) });
export const loginReplyInput = z.strictObject({ ...agent, id, promptId: id, value: z.string() });
export const loginCancelInput = z.strictObject({ ...agent, id: id.optional() }).default({});
export const uiInput = z.union([
  z.strictObject({ ...agent, id, value: z.string() }),
  z.strictObject({ ...agent, id, confirmed: z.boolean() }),
  z.strictObject({ ...agent, id, cancelled: z.literal(true) }),
]);
export const attachmentsInput = z.strictObject({
  images: z.array(image.extend({ mimeType: z.string().refine(value => ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(value), 'Unsupported image type') })).min(1),
});

const command = <T extends string>(type: T) => ({ ...agent, type: z.literal(type) });
export const commandInput = z.discriminatedUnion('type', [
  z.strictObject({ ...command('prompt'), ...prompt, streamingBehavior: z.enum(['steer', 'followUp']).optional() })
    .refine(value => value.message.trim().length > 0 || Boolean(value.images?.length), { message: 'Message is empty', path: ['message'] }),
  z.strictObject(command('abort')),
  z.strictObject(command('clear_queue')),
  z.strictObject({ ...command('fork'), entryId: id }),
  z.strictObject({ ...command('new_session'), parentSession: z.string().optional() }),
  z.strictObject({ ...command('set_model'), provider: id, modelId: id }),
  z.strictObject({ ...command('set_thinking_level'), level: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) }),
  z.strictObject(command('get_available_models')),
  z.strictObject(command('get_available_thinking_levels')),
  z.strictObject(command('get_system_prompt_document')),
  z.strictObject({ ...command('save_system_prompt'), prompt: z.strictObject({
    ...builder, title: z.string(), toolsAdded: z.array(z.strictObject({
      name: id, description: z.string(), parameters: z.record(z.string(), z.json()),
      constrainedSampling: z.union([
        z.literal(false),
        z.strictObject({ type: z.literal('json_schema'), strict: z.enum(['prefer', 'require']) }),
        z.strictObject({ type: z.literal('grammar'), variants: z.strictObject({ openai_lark: z.string().optional(), openai_regex: z.string().optional() }) }),
      ]).optional(),
    })),
  }) }),
  z.strictObject({ ...command('compact'), customInstructions: z.string().optional(), method: z.union([z.literal(1), z.literal(2)]).optional() }),
]);
