import Checkbox from './Checkbox';
import { showThinking, setShowThinking, collapseThinkingByDefault, setCollapseThinkingByDefault } from './thinking-content';

export default function ThinkingOptions() {
  return <>
    <label class="width-option">
      <span>Show thinking</span>
      <Checkbox checked={showThinking()} onChange={event => setShowThinking(event.currentTarget.checked)} />
    </label>
    <label class="width-option">
      <span>Collapse thinking by default</span>
      <Checkbox checked={collapseThinkingByDefault()} onChange={event => setCollapseThinkingByDefault(event.currentTarget.checked)} />
    </label>
  </>;
}
