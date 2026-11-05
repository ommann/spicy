import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const saved = new WeakMap<object, Map<string, string>>();

/** Keep image bytes out of JSONL. In-memory messages retain ordinary image data. */
export function serializeSessionEntry(entry: unknown, sessionFile: string): string {
  return JSON.stringify(entry, (_key, value) => {
    if (value?.type !== 'image' || typeof value.data !== 'string' || !extensions[value.mimeType]) return value;
    let locations = saved.get(value);
    if (!locations) saved.set(value, locations = new Map());
    const directory = dirname(sessionFile);
    let file = locations.get(directory);
    if (!file) {
      file = `attachments/${randomUUID()}.${extensions[value.mimeType]}`;
      mkdirSync(join(directory, 'attachments'), { recursive: true });
      writeFileSync(join(directory, file), Buffer.from(value.data, 'base64'), { flag: 'wx', mode: 0o600 });
      locations.set(directory, file);
    }
    const { data: _data, ...metadata } = value;
    return { ...metadata, file };
  });
}

/** Resolve only our attachment filenames, never arbitrary paths from a session. */
export function hydrateSessionEntry<T>(entry: T, sessionFile: string): T {
  function visit(value: any): any {
    if (!value || typeof value !== 'object') return value;
    if (value.type === 'image' && typeof value.file === 'string' && !value.data) {
      if (!/^attachments\/[a-f0-9-]+\.(png|jpg|webp|gif)$/.test(value.file)) throw new Error('Invalid session attachment path');
      const { file, ...metadata } = value;
      const image = { ...metadata, data: readFileSync(join(dirname(sessionFile), file)).toString('base64') };
      saved.set(image, new Map([[dirname(sessionFile), file]]));
      return image;
    }
    if (Array.isArray(value)) return value.map(visit);
    for (const key of Object.keys(value)) value[key] = visit(value[key]);
    return value;
  }
  return visit(entry);
}
