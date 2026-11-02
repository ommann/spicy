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
  availableTools?: Wire[];
  toolSources?: Record<string, string>;
  document: SystemPromptDocument;
  current: { content: string; sections: Record<string, string>; toolsAdded?: Wire[] };
  sources?: PromptSource[];
  currentSourceId?: string;
}

export interface CreatedPrompt {
  id: string;
  title: string;
  number?: number;
  document: SystemPromptDocument;
  excludedIds: string[];
  toolsAdded: Wire[];
}

export const SystemPromptCreatorContext = createContext<{
  load: () => Promise<PromptDocumentSnapshot>;
  reserveNumber: (requested?: number) => number;
  save: (prompt: Omit<CreatedPrompt, 'id'>) => void;
}>();
