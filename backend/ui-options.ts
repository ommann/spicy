import { uiOptions, withDatabase } from '../packages/coding-agent/src/core/session-storage.ts';
import { defaultUiOptions, type UiOptions } from '../shared/ui-options.ts';

export function readUiOptions(directory: string): UiOptions {
  return withDatabase(directory, true, db => {
    const options = { ...defaultUiOptions };
    for (const { key, value } of db.select().from(uiOptions).all()) {
      if (key === 'viewMode' && (value === 'focused' || value === 'side')) options.viewMode = value;
      if ((key === 'codeLinewrap' || key === 'chatArrowCursor' || key === 'pasteImagePaths')
        && (value === 'true' || value === 'false')) options[key] = value === 'true';
    }
    return options;
  })!;
}

export function changeUiOptions(directory: string, patch: Partial<UiOptions>): void {
  withDatabase(directory, true, db => db.transaction(tx => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      tx.insert(uiOptions).values({ key, value: String(value) })
        .onConflictDoUpdate({ target: uiOptions.key, set: { value: String(value) } }).run();
    }
  }));
}
