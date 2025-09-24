import { defineConfig, configDefaults } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './src'),
      '@': path.resolve(__dirname, './src')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    clearMocks: true,
    unstubEnvs: true,
    mockReset: true,
    restoreMocks: true,
    // Handle ESM module resolution
    server: {
      deps: {
        external: [/node_modules/]
      }
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov'],
      include: ['src/**'],
      exclude: [
        ...configDefaults.exclude,
        '.public',
        'coverage',
        'postcss.config.js',
        'stylelint.config.js',
        'src/**/*.test.js',
        'src/**/*.spec.js',
        'node_modules/**'
      ]
    },
    // Set up test environment
    setupFiles: ['./src/test-setup.js']
  }
})
