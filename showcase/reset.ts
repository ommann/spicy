import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createTwoFilesPatch } from 'diff';
const cwd = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const dir = fileURLToPath(new URL('../backend/.sessions/', import.meta.url));
fs.mkdirSync(dir, { recursive: true });
const existing = fs.readdirSync(dir).filter(x => x.endsWith('.jsonl')).filter(file => {
  const header = JSON.parse(fs.readFileSync(`${dir}/${file}`, 'utf8').split('\n')[0]);
  return header.urlId === 'showcase';
});
if (existing.length > 1) throw new Error('Multiple showcase sessions found; refusing to reset');
if (existing.length && !process.argv.includes('--reset')) {
  throw new Error('Reset discards discussions added to showcase. Run with --reset to confirm. Stop Spicy first if showcase is open.');
}
const now = new Date();
const id = randomUUID();
const rows = [{ type: 'session', version: 3, id, urlId: 'showcase', timestamp: now.toISOString(), cwd }];
let parentId = null;
function entry(value) { const item = { id: randomUUID().slice(0, 8), parentId, timestamp: new Date().toISOString(), ...value }; rows.push(item); parentId = item.id; }
function user(text) { entry({ type: 'message', message: { role: 'user', content: [{type:'text', text}], timestamp: Date.now() } }); }
function assistant(content, stopReason = 'stop') { entry({ type: 'message', message: { role: 'assistant', content: typeof content === 'string' ? [{type:'text',text:content}] : content, api: 'openai-responses', provider: 'openai', model: 'showcase', usage: {input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}, stopReason, timestamp: Date.now() } }); }
function tool(name, args, text, isError = false, details) { const call = randomUUID(); assistant([{type:'toolCall',id:call,name,arguments:args}], 'toolUse'); entry({type:'message',message:{role:'toolResult',toolCallId:call,toolName:name,content:[{type:'text',text}],isError,...(details ? {details} : {}),timestamp:Date.now()}}); }
entry({type:'session_info',name:'Showcase — chat element render feedback'});
user('Showcase: tailored static examples for reviewing chat rendering. These are synthetic messages and tool results; no commands shown here were executed.');
assistant('Short response.');
user('Markdown and links');
assistant('# Heading\n\nPlain text, **bold**, *italic*, and `inline code`.\n\n- First item\n- Second item\n  - Nested item\n\n1. Ordered item\n2. Another item\n\n> A block quote for rendering review.\n\n[Internet link](https://example.com) · [Local file](README.md)\n\n| Element | Example |\n| --- | --- |\n| Inline code | `value` |\n| Emphasis | **bold** |\n\n```typescript\nfunction greet(name: string): string {\n  return `Hello, ${name}`;\n}\n```');
for (const count of [1,3,5,8,10,11,12,24,80]) {
 user(`Tool output: ${count} lines (collapse threshold review)`);
 tool('bash',{command:`synthetic-output --lines ${count}`},Array.from({length:count},(_,i)=>`Line ${String(i+1).padStart(3,'0')}: ${i===0?'START':i===count-1?'END':'unchanged middle content'}`).join('\n'));
 assistant(`End of ${count}-line example.`);
}
user('Dense Node.js heredoc from a real chat: chained file rewrites, formatting, and checks. Display only; not executed.');
const denseHeredoc = JSON.parse(fs.readFileSync(new URL('./heredoc-dense-node.json', import.meta.url), 'utf8'));
tool('bash', { command: denseHeredoc.command }, 'Display-only replay of a historical command; not executed by showcase.');
user('Python through a shell heredoc: review the command before execution');
tool('bash', { command: "python3 <<'PY'\nimport json\nfrom pathlib import Path\n\npath = Path('package.json')\npackage = json.loads(path.read_text())\nprint(f\"Package: {package['name']}\")\nprint('No files changed')\nPY" }, 'Package: spicy\nNo files changed');
user('Node.js through a shell heredoc: review the command before execution');
tool('bash', { command: "node --input-type=module <<'JS'\nimport fs from 'node:fs';\n\nconst path = 'package.json';\nconst packageInfo = JSON.parse(fs.readFileSync(path, 'utf8'));\nconsole.log(`Package: ${packageInfo.name}`);\nconsole.log('No files changed');\nJS" }, 'Package: spicy\nNo files changed');
user('Problematic near-threshold collapse: Show more costs as much space as the hidden line');
tool('mcp__playwright__browser_take_screenshot', {element:'Both ranking titles and tables',target:'#ranking-picture',filename:'power-rankings.png',scale:'css'}, [
  '### Result',
  '- [Screenshot of Both ranking titles and tables](./power-rankings.png)',
  '### Ran Playwright code',
  '```js',
  '// Screenshot Both ranking titles and tables and save it as ./power-rankings.png',
  "await page.locator('#ranking-picture').screenshot({",
  "  path: './power-rankings.png',",
  "  scale: 'css',",
  "  type: 'png'",
  '});',
  '```',
].join('\n'));
assistant('Review whether collapsing this output saves any space after accounting for the Show more control.');
user('Long code and horizontal overflow');
assistant('```typescript\n'+Array.from({length:65},(_,i)=>`const example${i+1} = { index: ${i+1}, label: "Rendering example ${i+1}" };`).join('\n')+'\n```\n\n```text\n'+ 'A very wide line — '.repeat(30)+'\n```');
user('Long prose');
assistant(Array.from({length:18},(_,i)=>`Paragraph ${i+1}. This synthetic paragraph provides repeated text for reviewing wrapping, block height, scrolling, and collapsing. The beginning and ending should remain distinguishable when evaluating middle-collapse behavior.`).join('\n\n'));
user('Image referenced as an attachment-style file path:\n\n' + cwd + '/showcase/fixtures/collapse-example.png');
assistant('This example contains only the image file path as text, without embedded image data.');
entry({type:'message',message:{role:'user',content:[{type:'text',text:'User message with an attached image: this collapse hides almost nothing.'},{type:'image',mimeType:'image/png',data:fs.readFileSync(new URL('./fixtures/collapse-example.png', import.meta.url)).toString('base64')}],timestamp:Date.now()}});
assistant('This example tests an image attachment in a user message, separately from an image returned by read.');
user('Read an image: screenshot of a near-threshold collapse');
{
  const call = randomUUID();
  assistant([{type:'toolCall',id:call,name:'read',arguments:{path:'showcase/fixtures/collapse-example.png'}}], 'toolUse');
  entry({type:'message',message:{role:'toolResult',toolCallId:call,toolName:'read',content:[{type:'text',text:'Read image file [image/png]'},{type:'image',mimeType:'image/png',data:fs.readFileSync(new URL('./fixtures/collapse-example.png', import.meta.url)).toString('base64')}],isError:false,timestamp:Date.now()}});
}
assistant('The image above is the supplied example of a collapse control consuming the space it saves.');
user('Read result');
tool('read',{path:'/synthetic/example.ts',offset:1,limit:60},Array.from({length:60},(_,i)=>`export const item${i+1} = ${i+1};`).join('\n'));
user('Edit result with sparse changes');
tool('edit',{path:'/synthetic/example.ts',edits:[{oldText:'export const item8 = 8;',newText:'export const item8 = 80;'}]},'Successfully replaced 1 block in /synthetic/example.ts.');
user('Diff in a code block: changed lines separated by context');
assistant('```diff\n--- a/example.ts\n+++ b/example.ts\n@@ -1,24 +1,24 @@\n'+Array.from({length:24},(_,i)=>i===4?'-const early = false;\n+const early = true;':i===19?'-const late = false;\n+const late = true;':` const context${i+1} = ${i+1};`).join('\n')+'\n```');
user('Large recorded edit diff: 240 lines with sparse changes and a larger replacement');
const before = Array.from({length:240}, (_, i) => `export const setting${i + 1} = { enabled: false, limit: ${i + 1} };`).join('\n') + '\n';
const after = before.split('\n').map((line, i) => [5, 70, 225].includes(i) || (i >= 120 && i < 145) ? line.replace('false', 'true').replace('limit:', 'maximum:') : line).join('\n');
const patch = createTwoFilesPatch('example.ts', 'example.ts', before, after, '', '', {context:12});
tool('edit', {path:'example.ts', edits:[{oldText:before,newText:after}]}, 'Successfully replaced 1 block in example.ts.', false, {patch, firstChangedLine:6, oldLineCount:before.replace(/\n$/, '').split('\n').length, newLineCount:after.replace(/\n$/, '').split('\n').length});
assistant('End of large recorded diff. The source file is synthetic; nothing was edited on disk.');
user('Thinking, ANSI output, and a tool error');
assistant([{type:'thinking',thinking:'Synthetic thinking block.\n'+Array.from({length:18},(_,i)=>`Review step ${i+1}: consider content height and visibility.`).join('\n')},{type:'text',text:'Response following the synthetic thinking block.'}]);
tool('bash',{command:'synthetic-check'},'\u001b[32mPASS\u001b[0m short check\n\u001b[33mWARN\u001b[0m demonstration only\n\u001b[31mFAIL\u001b[0m synthetic error',true);
assistant('End of the initial static showcase. Streaming and other live states are not simulated here.');
const file = existing.length ? `${dir}/${existing[0]}` : `${dir}/${now.toISOString().replace(/[:.]/g,'-')}_${id}.jsonl`;
// Preserve session identity when resetting, while replacing the entire entry history.
if (existing.length) rows[0].id = JSON.parse(fs.readFileSync(file, 'utf8').split('\n')[0]).id;
fs.writeFileSync(file,rows.map(x=>JSON.stringify(x)).join('\n')+'\n');
console.log(file);
