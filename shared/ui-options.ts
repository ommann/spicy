export interface UiOptions {
  codeLinewrap: boolean;
  chatArrowCursor: boolean;
  pasteImagePaths: boolean;
  viewMode: 'focused' | 'side';
}

export const defaultUiOptions: UiOptions = {
  codeLinewrap: false,
  chatArrowCursor: false,
  pasteImagePaths: false,
  viewMode: 'side',
};
