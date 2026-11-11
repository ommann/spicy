import Checkbox from './Checkbox';
import { chatArrowCursor, setChatArrowCursor } from './chat-cursor';

export default function CursorOption() {
  return <label class="width-option">
    <span>Use arrow cursor only</span>
    <Checkbox checked={chatArrowCursor()} onChange={event => setChatArrowCursor(event.currentTarget.checked)} />
  </label>;
}
