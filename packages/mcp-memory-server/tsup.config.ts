import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node22',
  clean: true,
  // Workspace packages ship raw TypeScript, so they must be bundled rather than
  // required at runtime. Mirrors apps/server's tsup config.
  noExternal: ['@asterim/shared', 'asterim'],
  // node:sqlite is a Node builtin; the SDK and its transitive deps stay external
  // so the bundle does not inline express/hono, which the stdio path never loads.
  external: ['node:sqlite', '@modelcontextprotocol/sdk'],
  banner: {
    js: '#!/usr/bin/env node'
  }
});
