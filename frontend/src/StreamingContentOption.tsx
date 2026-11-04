import Checkbox from './Checkbox';
import { streamingContent, setStreamingContent } from './streaming-content';

export default function StreamingContentOption() {
  return <label class="width-option">
    <span>Show streaming content</span>
    <Checkbox checked={streamingContent()} onChange={event => setStreamingContent(event.currentTarget.checked)} />
  </label>;
}
