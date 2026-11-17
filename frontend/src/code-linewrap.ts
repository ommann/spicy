import { uiOptions, setUiOption } from './ui-options';

export const codeLinewrap = () => uiOptions().codeLinewrap;
export function setCodeLinewrap(value: boolean) {
  setUiOption('codeLinewrap', value);
}
