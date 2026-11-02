import js from '@eslint/js'
import jsdoc from 'eslint-plugin-jsdoc'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'presets/*/dump/**', '.yarn/**', 'examples/**/*.cjs', 'examples/cypress/cypress/**', 'examples/nextjs/**', 'examples/extensions/**'] },
  js.configs.recommended,
  { languageOptions: { globals: { URL: 'readonly', Buffer: 'readonly', process: 'readonly', console: 'readonly', fetch: 'readonly', Request: 'readonly', Response: 'readonly', URLSearchParams: 'readonly', Intl: 'readonly', setInterval: 'readonly' } } },
  ...tseslint.configs.strict,
  jsdoc.configs['flat/recommended-typescript'],
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      // The JSDoc is the API reference: a param says what it is, and a tag is not required on every function.
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/require-param': 'off',
      'jsdoc/require-returns': 'off',
      'jsdoc/require-param-description': 'error',
      'jsdoc/check-param-names': ['error', { checkDestructured: false }],
      'jsdoc/tag-lines': 'off',
    },
  },
)
