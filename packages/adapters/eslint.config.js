import { nodeConfig } from '@asterim/eslint-config';
export default [
  { ignores: ['dist'] },
  ...nodeConfig,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-empty': 'off'
    }
  }
];
