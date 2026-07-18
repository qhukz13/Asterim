import { nodeConfig } from '@asterim/eslint-config';
export default [
  { ignores: ['dist'] },
  ...nodeConfig,
  {
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-useless-escape': 'off'
    }
  }
];
