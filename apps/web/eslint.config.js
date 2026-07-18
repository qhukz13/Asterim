import { reactConfig } from '@asterim/eslint-config';
export default [
  { ignores: ['dist', 'dev-dist', 'public'] },
  ...reactConfig,
  {
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/rules-of-hooks': 'off',
      'no-useless-escape': 'off'
    }
  }
];
