import { createSignal } from 'solid-js';

export const [showThinking, setShowThinking] = createSignal(true);
export const [collapseThinkingByDefault, setCollapseThinkingByDefault] = createSignal(false);
