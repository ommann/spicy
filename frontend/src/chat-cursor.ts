import { uiOptions, setUiOption } from './ui-options';

export const chatArrowCursor = () => uiOptions().chatArrowCursor;
export function setChatArrowCursor(value: boolean) {
  setUiOption('chatArrowCursor', value);
}
