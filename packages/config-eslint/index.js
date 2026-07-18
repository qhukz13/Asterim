import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// Base config for all TypeScript files
export const baseConfig = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module'
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
    }
  }
];

// React-specific config
export const reactConfig = [
  ...baseConfig,
  {
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    languageOptions: {
      globals: {
        ...globals.browser
      }
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }]
    }
  }
];

// Node.js specific config
export const nodeConfig = [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  }
];
