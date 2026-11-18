import { test, expect } from 'vitest';
import { inheritedBranchModel } from '../src/branch-model';

const entries = [
  { id: 'initial', parentId: null, type: 'model_change', provider: 'provider', modelId: 'a' },
  { id: 'system', parentId: 'initial', message: { role: 'system' } },
  { id: 'user', parentId: 'system', message: { role: 'user' } },
  { id: 'changed', parentId: 'system', type: 'model_change', provider: 'other', modelId: 'b' },
  { id: 'fork-user', parentId: 'changed', message: { role: 'user' } },
];

test('model inheritance follows the branch, not the latest model in the file', () => {
  expect(inheritedBranchModel(entries, 'user')).toEqual({ provider: 'provider', id: 'a' });
  expect(inheritedBranchModel(entries, 'fork-user')).toEqual({ provider: 'other', id: 'b' });
  expect(inheritedBranchModel(entries, 'system')).toEqual({ provider: 'provider', id: 'a' });
});

test('assistant model metadata supplies the model in older histories', () => {
  expect(inheritedBranchModel([
    { id: 'reply', parentId: null, message: { role: 'assistant', provider: 'old', model: 'legacy' } },
  ], 'reply')).toEqual({ provider: 'old', id: 'legacy' });
});

test('missing ancestry has no invented model', () => {
  expect(inheritedBranchModel(entries, null)).toBeUndefined();
  expect(inheritedBranchModel(entries, 'missing')).toBeUndefined();
});
