import { createSignal } from 'solid-js';
import { defaultUiOptions, type UiOptions } from '../../shared/ui-options.ts';
import { api } from './api';

const [options, setOptions] = createSignal<UiOptions>({ ...defaultUiOptions });
export const uiOptions = options;
let changed: Partial<UiOptions> = {};
let writes = Promise.resolve();

export async function loadUiOptions() {
  const saved = await api.uiOptions.get({});
  // Preserve edits made while the initial request was in flight.
  setOptions({ ...saved, ...changed });
}

export function setUiOption<K extends keyof UiOptions>(key: K, value: UiOptions[K]) {
  const patch = { [key]: value } as Partial<UiOptions>;
  changed = { ...changed, ...patch };
  setOptions(current => ({ ...current, ...patch }));
  // Serialize writes so rapid toggles cannot persist out of order.
  writes = writes.then(async () => {
    const { token } = await api.info({});
    await api.uiOptions.change(patch, { context: { token } });
  }).catch(error => { console.error('Could not save UI option', error); });
}
