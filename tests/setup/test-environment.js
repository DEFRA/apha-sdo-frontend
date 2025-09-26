/**
 * Test Environment Setup
 *
 * This file ensures proper test environment configuration for all services
 * including Azure Storage, S3, and other external dependencies.
 */

// Set test environment variables before any imports
// This ensures they're available when config.js is loaded
process.env.NODE_ENV = 'test'
process.env.AZURE_STORAGE_CONNECTION_STRING =
  'DefaultEndpointsProtocol=https;AccountName=test;AccountKey=key;EndpointSuffix=core.windows.net'
process.env.AZURE_CONTAINER_NAME = 'test-container'
process.env.AWS_REGION = 'eu-west-2'
process.env.AWS_ACCESS_KEY_ID = 'test-key'
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret'
process.env.S3_BUCKET_NAME = 'test-bucket'
process.env.CDP_UPLOADER_ENDPOINT = 'https://test-uploader.service.gov.uk'
process.env.CDP_UPLOADER_API_KEY = 'test-api-key'
process.env.LOG_ENABLED = 'false'

// Verify environment variables are set
console.log(
  'Test environment setup - Azure config:',
  process.env.AZURE_STORAGE_CONNECTION_STRING ? 'OK' : 'MISSING'
)

// Global test utilities
global.testTimeout = 10000

/**
 * Create a test-safe Azure Storage configuration
 */
export const createTestAzureConfig = () => ({
  'storage.azure.connectionString':
    'DefaultEndpointsProtocol=https;AccountName=test;AccountKey=key;EndpointSuffix=core.windows.net',
  'storage.azure.containerName': 'test-container'
})

/**
 * Create a test-safe S3 configuration
 */
export const createTestS3Config = () => ({
  'storage.s3.region': 'eu-west-2',
  'storage.s3.accessKeyId': 'test-access-key',
  'storage.s3.secretAccessKey': 'test-secret-key',
  'storage.s3.bucket': 'test-bucket'
})

/**
 * Create a test-safe CDP Uploader configuration
 */
export const createTestCdpUploaderConfig = () => ({
  'storage.cdpUploader.endpoint': 'https://test-uploader.service.gov.uk',
  'storage.cdpUploader.apiKey': 'test-api-key'
})

/**
 * Create complete test configuration
 */
export const createCompleteTestConfig = () => ({
  ...createTestAzureConfig(),
  ...createTestS3Config(),
  ...createTestCdpUploaderConfig(),
  'storage.maxFileSize': 52428800, // 50MB
  'storage.allowedMimeTypes': [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv'
  ]
})

/**
 * Setup graceful error handling for tests
 */
export const setupGracefulErrorHandling = () => {
  const originalConsoleError = console.error

  console.error = (...args) => {
    // Filter out expected test errors
    const message = args.join(' ')
    if (
      message.includes('Azure Storage client is not available') ||
      message.includes('S3 client is not available') ||
      message.includes('CDP Uploader is not available')
    ) {
      return // Suppress expected test errors
    }
    originalConsoleError(...args)
  }

  return () => {
    console.error = originalConsoleError
  }
}

/**
 * Validate test environment
 */
export const validateTestEnvironment = () => {
  const requiredVars = [
    'NODE_ENV',
    'AZURE_STORAGE_CONNECTION_STRING',
    'AZURE_CONTAINER_NAME'
  ]

  const missing = requiredVars.filter((varName) => !process.env[varName])

  if (missing.length > 0) {
    throw new Error(
      `Missing required test environment variables: ${missing.join(', ')}`
    )
  }

  if (process.env.NODE_ENV !== 'test') {
    throw new Error('NODE_ENV must be set to "test" for running tests')
  }

  return true
}

// Auto-validate on import
try {
  validateTestEnvironment()
} catch (error) {
  console.warn('Test environment validation warning:', error.message)
}
