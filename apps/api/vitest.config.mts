import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC keeps NestJS decorator metadata (esbuild drops it) and handles ESM dependencies like NestJS 12.
// Inline projects inherit these plugins, so they are declared once here.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    projects: [
      {
        test: { name: 'unit', include: ['src/**/*.spec.ts'] },
      },
      {
        test: {
          name: 'integration',
          include: ['test/**/*.int-spec.ts'],
          setupFiles: ['test/load-env.ts'],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
