import { createSignal } from 'solid-js';

const [streamingContent, updateStreamingContent] = createSignal(false);
export { streamingContent };

export function setStreamingContent(value: boolean) {
  updateStreamingContent(value);
}
