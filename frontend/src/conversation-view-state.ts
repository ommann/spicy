import { createStore } from 'solid-js/store';
import type { ImageAttachment } from './image-attachments';

export type ConversationMode = 'focused' | 'side';
export interface ReadingPosition {
  anchor?: { id: string; offset: number; elementPath?: number[] };
  followLatest: boolean;
}

export function createConversationViewState() {
  return createStore({
    selectedKey: '',
    pointer: undefined as { x: number; y: number } | undefined,
    cursorAnchor: undefined as ReadingPosition['anchor'],
    initialized: false,
    appliedFocusRevision: undefined as number | undefined,
    widths: { focused: 720, side: 1040 },
    focusedFitsWindow: true,
    positions: {} as Partial<Record<ConversationMode, ReadingPosition>>,
    lastPosition: undefined as ReadingPosition | undefined,
    modeTransition: undefined as { mode: ConversationMode; position: ReadingPosition } | undefined,
    images: {} as Record<string, ImageAttachment[]>,
  });
}

export type ConversationViewState = ReturnType<typeof createConversationViewState>;
