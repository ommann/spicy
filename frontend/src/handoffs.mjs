import { taskIdPattern } from './utw/task-id.mjs';

export const isHandoff = name => ['handoff_task_to_user', 'get_handoff_result'].includes(name);

// Same handle lookup and presentation rules as UTW's PoC harness.
export function handoffHandle(call, result) {
  if (!isHandoff(call?.name)) return;
  if (taskIdPattern.test(result?.details?.task_id)) return result.details;
  for (const block of result?.content || []) {
    if (block.type !== 'text') continue;
    try {
      const value = JSON.parse(block.text);
      if (taskIdPattern.test(value?.task_id)) return value;
    } catch { /* Non-handle tool output. */ }
  }
  if (call.name === 'get_handoff_result' && taskIdPattern.test(call.arguments?.task_id)) return { task_id: call.arguments.task_id };
}

export const handoffId = (call, result) => handoffHandle(call, result)?.task_id;

export function handoffUrl(task) {
  if (!['incomplete', 'completed', 'rejected'].includes(task?.status)) return;
  try {
    const url = new URL(task.ui?.url);
    if (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && !url.username && !url.password) return url.href;
  } catch { /* No usable UI yet. */ }
}

export function contentText(content) {
  if (typeof content === 'string') return content;
  return (content || []).map(b => b.type === 'text' ? b.text : b.type === 'image' ? '[image]' : '').join('\n');
}

export function handoffResultData(result) {
  if (result?.details && typeof result.details === 'object') return result.details;
  try { return JSON.parse(contentText(result?.content)); }
  catch { return null; }
}
