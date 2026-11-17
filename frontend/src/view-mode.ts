import { uiOptions, setUiOption } from './ui-options';

export type ViewMode = 'focused' | 'side';
export const viewMode = () => uiOptions().viewMode;

export function chatViewPath(mode = viewMode()) {
  return mode === 'focused' ? '/single' : '/tree';
}

export function setViewMode(value: ViewMode) {
  setUiOption('viewMode', value);
}
