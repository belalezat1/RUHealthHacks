import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    exclude: ['tests/**', 'node_modules/**'],
    setupFiles: './src/test-setup.ts',
  },
})