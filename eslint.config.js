import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Базовые рекомендованные правила JS + TypeScript для каталога src/.
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
