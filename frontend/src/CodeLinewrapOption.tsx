import Checkbox from './Checkbox';
import { codeLinewrap, setCodeLinewrap } from './code-linewrap';

export default function CodeLinewrapOption() {
  return <label class="width-option">
    <span>Code linewrap</span>
    <Checkbox checked={codeLinewrap()} onChange={event => setCodeLinewrap(event.currentTarget.checked)} />
  </label>;
}
