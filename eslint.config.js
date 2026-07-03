import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Базовые рекомендованные правила JS + TypeScript для каталога src/.
export default tseslint.config(
  // skills/** — упакованный контент скилла, включая генерируемый esbuild-бандл
  // scripts/tinvest.cjs (собранный CJS, не исходник — линтить его не нужно).
  { ignores: ['dist/**', 'node_modules/**', 'skills/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
