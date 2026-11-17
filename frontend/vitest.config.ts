import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../vitest.base.ts';

// DOM tests build the real Solid components themselves; do not inherit the app's Vite plugins.
export default mergeConfig(baseConfig, defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
}));
