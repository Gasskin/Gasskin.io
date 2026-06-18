import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  test: {
    environment: 'jsdom',
    exclude: ['**/node_modules/**', '**/dist/**', '**/src-tauri/target/**', '**/.omx/**'],
    globals: true,
    restoreMocks: true,
    setupFiles: ['./src/test/setup.ts']
  }
})
