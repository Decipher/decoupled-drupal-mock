import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'presets/*/dump/**'] },
  js.configs.recommended,
  { languageOptions: { globals: { URL: 'readonly', Buffer: 'readonly', process: 'readonly', console: 'readonly', fetch: 'readonly', Request: 'readonly', Response: 'readonly', URLSearchParams: 'readonly' } } },
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] } },
)
