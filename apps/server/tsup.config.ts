import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node22',
  clean: true,
  noExternal: ['@asterim/shared', '@asterim/adapters'],
  external: [
    'node:sqlite',
    'node-pty',
    'chokidar',
    'fastify',
    'socket.io',
    'socket.io-client',
    'simple-git',
    'web-push',
    '@fastify/cors',
    '@fastify/static',
    'bonjour-service'
  ],
  banner: {
    js: '#!/usr/bin/env node'
  }
});
