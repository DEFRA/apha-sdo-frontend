import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    clearMocks: true,
    testTimeout: 10000,
    // setupFiles: ['./tests/setup/test-environment.js'],
    env: {
      NODE_ENV: 'test',
      AZURE_STORAGE_CONNECTION_STRING:
        'DefaultEndpointsProtocol=https;AccountName=test;AccountKey=key;EndpointSuffix=core.windows.net',
      AZURE_CONTAINER_NAME: 'test-container',
      AWS_REGION: 'eu-west-2',
      AWS_ACCESS_KEY_ID: 'test-key',
      AWS_SECRET_ACCESS_KEY: 'test-secret',
      S3_BUCKET_NAME: 'test-bucket',
      LOG_ENABLED: 'false'
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
        'tests/setup/**'
      ]
    }
  }
})
