export function parseBashCommand(message: string, hasImages = false) {
  if (!message.startsWith('!')) return undefined;
  const excludeFromContext = message.startsWith('!!');
  const command = message.slice(excludeFromContext ? 2 : 1).trim();
  if (!command) throw new Error('Shell command is empty');
  if (hasImages) throw new Error('Shell commands cannot include image attachments');
  return { type: 'bash' as const, command, excludeFromContext };
}
