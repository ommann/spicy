import { createContext } from 'solid-js';
import type { SystemPromptBuilder, SystemPromptDocument } from '../../packages/coding-agent/src/core/system-prompt-document';
import type { SavedPromptInput } from './api';
export type PromptTool = SavedPromptInput['toolsAdded'][number];

export interface PromptSource {
  id: string;
  label: string;
  document: SystemPromptDocument;
  excludedIds?: string[];
  toolsAdded?: PromptTool[];
  diagnostic?: string;
}

export interface PromptDocumentSnapshot {
  availableTools?: PromptTool[];
  toolSources?: Record<string, string>;
  document: SystemPromptDocument;
  excludedIds?: string[];
  currentBuilder?: SystemPromptBuilder;
  diagnostic?: string;
  current: { content: string; sections: Record<string, string>; toolsAdded?: PromptTool[]; systemPromptKey?: string };
  sources?: PromptSource[];
  currentSourceId?: string;
}

export interface CreatedPrompt extends SavedPromptInput {
  id: string;
  output: { content: string; sections?: Record<string, string> };
}

export const SystemPromptCreatorContext = createContext<{
  load: () => Promise<PromptDocumentSnapshot>;
  save: (prompt: Omit<CreatedPrompt, 'id' | 'output'>) => Promise<void>;
}>();
