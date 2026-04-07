// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.strict,
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
);
