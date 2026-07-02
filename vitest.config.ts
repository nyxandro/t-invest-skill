import { defineConfig } from 'vitest/config';

// Тесты лежат рядом с кодом (*.test.ts в src/), окружение — Node.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
