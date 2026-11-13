/** Parse /compact [1|2] [instructions], keeping unnumbered commands compatible. */
export function parseCompactionCommand(message) {
  const command = /^\/compact(?:\s|$)/.exec(message.trim());
  if (!command) return null;
  let instructions = message.trim().slice('/compact'.length).trim();
  const number = /^(\d+)(?:\s|$)/.exec(instructions);
  /** @type {1 | 2} */
  let method = 1;
  if (number) {
    if (number[1] !== '1' && number[1] !== '2') throw new Error(`Unknown compaction method: ${number[1]}`);
    method = number[1] === '2' ? 2 : 1;
    instructions = instructions.slice(number[1].length).trim();
  }
  return { method, customInstructions: instructions || undefined };
}
