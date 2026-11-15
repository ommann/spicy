import type { BranchLabel } from './branch-labels.ts';

export type PreviewRow = {
  id: string;
  text: string;
  href: string;
  user?: boolean;
  end?: { text: string; href: string; user?: boolean };
  prompt: string;
  compactionStart?: boolean;
  padding: string;
  labels: BranchLabel[];
  annotation?: string;
};

export type HistoryRow = { id: string; text: string; prompt?: number; associatedPrompt?: number; title?: boolean; user?: boolean; priority?: boolean; endsLane?: boolean; compactionStart?: boolean; compactionRoot?: string; annotation?: string; label?: { text: string; color: string }; href?: string; children: HistoryRow[] };
