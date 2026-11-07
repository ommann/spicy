import Checkbox from './Checkbox';
import { showOnlyHiddenBranches, setShowOnlyHiddenBranches } from './branch-visibility';

export default function HiddenBranchesOption() {
  return <label class="width-option">
    <span>Show only hidden branches</span>
    <Checkbox checked={showOnlyHiddenBranches()} onChange={event => setShowOnlyHiddenBranches(event.currentTarget.checked)} />
  </label>;
}
