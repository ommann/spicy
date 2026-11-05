import Checkbox from './Checkbox';
import { pasteImagePaths, setPasteImagePaths } from './image-paste-mode';

export default function ImagePasteOption() {
  return <label class="width-option">
    <span>Paste images as file paths</span>
    <Checkbox checked={pasteImagePaths()} onChange={event => setPasteImagePaths(event.currentTarget.checked)} />
  </label>;
}
