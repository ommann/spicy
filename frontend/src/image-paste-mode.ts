import { uiOptions, setUiOption } from './ui-options';

export const pasteImagePaths = () => uiOptions().pasteImagePaths;
export function setPasteImagePaths(value: boolean) {
  setUiOption('pasteImagePaths', value);
}
