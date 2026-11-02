import { createContext } from 'solid-js';
import type { SystemPromptDocument } from '../../packages/coding-agent/src/core/system-prompt-document';
import type { Wire } from './types';

export interface PromptSource {
  id: string;
  label: string;
  document: SystemPromptDocument;
  excludedIds?: string[];
  toolsAdded?: Wire[];
}

export interface PromptDocumentSnapshot {
  document: SystemPromptDocument;
  current: { content: string; sections: Record<string, string>; toolsAdded?: Wire[] };
  sources?: PromptSource[];
}

export interface CreatedPrompt {
  id: string;
  title: string;
  document: SystemPromptDocument;
  excludedIds: string[];
  toolsAdded: Wire[];
}

export const SystemPromptCreatorContext = createContext<{
  load: () => Promise<PromptDocumentSnapshot>;
  save: (prompt: Omit<CreatedPrompt, 'id'>) => void;
}>();
