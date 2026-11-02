const storageKey = 'spicy.system-prompt-numbers';

class PromptNumbers extends Map<string, number> {
  constructor(entries: [string, number][], private persist: (entries: [string, number][]) => void) {
    super();
    for (const [key, value] of entries) super.set(key, value);
  }

  override set(key: string, value: number) {
    super.set(key, value);
    this.persist([...this]);
    return this;
  }
}

export function createPromptNumberRegistry() {
  let saved: Record<string, [string, number][]>;
  try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); }
  catch { saved = {}; }
  const sessions = new Map<string, Map<string, number>>();
  return (id: string) => {
    if (!sessions.has(id)) sessions.set(id, new PromptNumbers(saved[id] || [], entries => {
      saved[id] = entries;
      try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* Storage may be unavailable. */ }
    }));
    return sessions.get(id)!;
  };
}

export function reservePromptNumber(numbers: Map<string, number>, requested?: number) {
  const last = Math.max(0, ...numbers.values());
  const number = requested ?? last + 1;
  if (!Number.isSafeInteger(number) || number <= last) throw new Error(`Choose a shorthand above System Prompt ${last}. Earlier numbers are reserved.`);
  numbers.set(`reserved:${number}`, number);
  return number;
}
