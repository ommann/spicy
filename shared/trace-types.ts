// Trace records allow extension-defined roles, blocks and fields.
// Preserve those wire fields at the boundary; derived UI models use explicit types.
export type Wire = Record<string, any>;

export interface PrefixState {
  captured: boolean;
  rootId: string | null;
  content: string | Wire[];
  sections: Map<string, string>;
  tools: Map<string, Wire>;
  key: string;
  promptKey?: string;
  promptBuilder?: Wire;
}
