import { createSignal } from 'solid-js';

const [streamingContent, updateStreamingContent] = createSignal(true);
export { streamingContent };

export function setStreamingContent(value: boolean) {
  updateStreamingContent(value);
}
