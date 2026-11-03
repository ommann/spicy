import { createContext } from 'solid-js';
import type { SystemPromptBuilder, SystemPromptDocument } from '../../packages/coding-agent/src/core/system-prompt-document';
import type { Wire } from './types';

export interface PromptSource {
  id: string;
  label: string;
  document: SystemPromptDocument;
  excludedIds?: string[];
  toolsAdded?: Wire[];
  diagnostic?: string;
}

export interface PromptDocumentSnapshot {
  availableTools?: Wire[];
  toolSources?: Record<string, string>;
  document: SystemPromptDocument;
  excludedIds?: string[];
  currentBuilder?: SystemPromptBuilder;
  diagnostic?: string;
  current: { content: string; sections: Record<string, string>; toolsAdded?: Wire[]; systemPromptKey?: string };
  sources?: PromptSource[];
  currentSourceId?: string;
}

export interface CreatedPrompt {
  id: string;
  title: string;
  document: SystemPromptDocument;
  excludedIds: string[];
  toolsAdded: Wire[];
  output: { content: string; sections?: Record<string, string> };
}

export const SystemPromptCreatorContext = createContext<{
  load: () => Promise<PromptDocumentSnapshot>;
  save: (prompt: Omit<CreatedPrompt, 'id' | 'output'>) => Promise<void>;
}>();
