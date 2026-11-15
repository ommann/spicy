import { createSignal } from 'solid-js';
import { api } from './api';
import type { BranchLabel } from '../../shared/branch-labels.ts';
export type { BranchLabel } from '../../shared/branch-labels.ts';

const [labels, setLabels] = createSignal<Record<string, BranchLabel>>({});
export const branchLabel = (key: string) => labels()[key];
export async function loadBranchLabels() {
  setLabels(await api.branchLabels.list({}));
}
async function change(input: Parameters<typeof api.branchLabels.change>[0]) {
  const { token } = await api.info({});
  setLabels(await api.branchLabels.change(input, { context: { token } }));
}
export async function transferBranchLabel(from: string, to: string) {
  if (from !== to && labels()[from]) await change({ key: to, from });
}
export async function setBranchLabel(key: string, label?: BranchLabel) {
  await change({ key, label });
}
