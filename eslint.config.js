import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'release/**', 'node_modules/**', 'docs/design/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['fixtures/theme.js'],
    languageOptions: {
      globals: {
        HTMLElement: 'readonly', customElements: 'readonly', location: 'readonly', history: 'readonly',
        navigator: 'readonly', URL: 'readonly', fetch: 'readonly', document: 'readonly', window: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', console: 'readonly',
      },
    },
    rules: { '@typescript-eslint/no-this-alias': 'off' },
  },
  {
    languageOptions: {
      globals: {
        window: 'readonly', document: 'readonly', chrome: 'readonly', console: 'readonly',
        process: 'readonly', URL: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        fetch: 'readonly', Buffer: 'readonly', globalThis: 'readonly', URLSearchParams: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', TextEncoder: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);
