import Checkbox from './Checkbox';
import { showBoldSyntax, setShowBoldSyntax, showItalicSyntax, setShowItalicSyntax, showInlineCodeSyntax, setShowInlineCodeSyntax } from './formatting-syntax';

export default function SyntaxOptions() {
  return <>
    <label class="width-option">
      <span>Show bold syntax</span>
      <Checkbox checked={showBoldSyntax()} onChange={event => setShowBoldSyntax(event.currentTarget.checked)} />
    </label>
    <label class="width-option">
      <span>Show italic syntax</span>
      <Checkbox checked={showItalicSyntax()} onChange={event => setShowItalicSyntax(event.currentTarget.checked)} />
    </label>
    <label class="width-option">
      <span>Show inline code syntax</span>
      <Checkbox checked={showInlineCodeSyntax()} onChange={event => setShowInlineCodeSyntax(event.currentTarget.checked)} />
    </label>
  </>;
}
