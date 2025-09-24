import { config } from '../../config/config.js'
import { logger } from '../common/helpers/logging/logger.js'

// Private state for configuration
const configState = {
  config: null,
  connectionType: null,
  initialized: false,
  validationResults: null
}

const DEFAULT_CONFIG = {
  connectionString: null,
  accountName: null,
  accountKey: null,
  sasToken: null,

  tenantId: null,
  clientId: null,
  clientSecret: null,

  containerName: 'apha-sdo-files',
  stagingContainer: 'apha-sdo-staging',
  archiveContainer: 'apha-sdo-archive',

  maxFileSize: 50 * 1024 * 1024, // 50MB
  blockSize: 4 * 1024 * 1024, // 4MB
  maxConcurrency: 5,
  enableProgressTracking: true,

  maxRetries: 3,
  retryDelayMs: 1000,
  maxRetryDelayMs: 30000,

  enableEncryption: true,
  accessTier: 'Hot',
  publicAccess: 'none'
}

export async function initialize() {
  if (configState.initialized) {
    return { success: true, config: configState.config }
  }

  try {
    logger.info('Initializing Azure configuration')

    let azureConfig = {}
    try {
      azureConfig = config.get('azureStorage') || {}
    } catch (error) {
      logger.warn(
        'Failed to load Azure configuration from main config, using defaults',
        {
          error: error.message
        }
      )
    }

    if (
      process.env.NODE_ENV === 'test' &&
      !azureConfig.connectionString &&
      !azureConfig.accountName
    ) {
      const testConnectionString = process.env.AZURE_TEST_CONNECTION_STRING
      const testAccountName = process.env.AZURE_TEST_ACCOUNT_NAME

      if (!testConnectionString && !testAccountName) {
        logger.warn(
          'No Azure test configuration available, some tests may fail'
        )
        azureConfig = {
          connectionString: null,
          accountName: null,
          containerName: 'test-container',
          ...azureConfig
        }
      } else {
        azureConfig = {
          connectionString: testConnectionString,
          accountName: testAccountName,
          containerName:
            process.env.AZURE_TEST_CONTAINER_NAME || 'test-container',
          ...azureConfig
        }
      }
    }

    configState.config = {
      ...DEFAULT_CONFIG,
      ...azureConfig
    }

    configState.connectionType = determineConnectionType(configState.config)

    const validation = validateConfiguration(configState.config)
    configState.validationResults = validation

    if (!validation.valid) {
      throw new Error(
        `Azure configuration validation failed: ${validation.errors.join(', ')}`
      )
    }

    configState.initialized = true

    logger.info('Azure configuration initialized successfully', {
      connectionType: configState.connectionType,
      containerName: configState.config.containerName,
      accountName: configState.config.accountName
    })

    return {
      success: true,
      config: configState.config,
      connectionType: configState.connectionType
    }
  } catch (error) {
    logger.error('Azure configuration initialization failed', {
      error: error.message,
      stack: error.stack,
      nodeEnv: process.env.NODE_ENV
    })

    configState.config = null
    configState.connectionType = null
    configState.initialized = false
    configState.validationResults = null

    return {
      success: false,
      error: error.message
    }
  }
}

export function get(key) {
  if (!configState.initialized) {
    throw new Error(
      'Azure configuration not initialized. Call initialize() first.'
    )
  }

  return configState.config[key]
}

export function getAll() {
  if (!configState.initialized) {
    throw new Error(
      'Azure configuration not initialized. Call initialize() first.'
    )
  }

  return { ...configState.config }
}

export function getConnectionType() {
  return configState.connectionType
}

export function getContainerName() {
  return configState.config?.containerName || DEFAULT_CONFIG.containerName
}

export function getStagingContainer() {
  return configState.config?.stagingContainer || DEFAULT_CONFIG.stagingContainer
}

export function getArchiveContainer() {
  return configState.config?.archiveContainer || DEFAULT_CONFIG.archiveContainer
}

export function getRetryConfig() {
  return {
    maxRetries: configState.config?.maxRetries || DEFAULT_CONFIG.maxRetries,
    retryDelayMs:
      configState.config?.retryDelayMs || DEFAULT_CONFIG.retryDelayMs,
    maxRetryDelayMs:
      configState.config?.maxRetryDelayMs || DEFAULT_CONFIG.maxRetryDelayMs
  }
}

export function getHealthStatus() {
  return {
    initialized: configState.initialized,
    connectionType: configState.connectionType,
    validation: configState.validationResults,
    accountName: configState.config?.accountName,
    containerName: configState.config?.containerName,
    timestamp: new Date().toISOString()
  }
}

export function isInitialized() {
  return configState.initialized
}

export function reset() {
  configState.config = null
  configState.connectionType = null
  configState.initialized = false
  configState.validationResults = null
}

function determineConnectionType(config) {
  if (config.connectionString) {
    return 'connectionString'
  } else if (config.accountName && config.accountKey) {
    return 'accountKey'
  } else if (config.accountName && config.sasToken) {
    return 'sasToken'
  } else if (
    config.tenantId &&
    config.clientId &&
    config.clientSecret &&
    config.accountName
  ) {
    return 'servicePrincipal'
  } else {
    return 'unknown'
  }
}

function validateConfiguration(config) {
  const errors = []
  const warnings = []

  const hasConnectionString = !!config.connectionString
  const hasAccountKey = !!(config.accountName && config.accountKey)
  const hasSasToken = !!(config.accountName && config.sasToken)
  const hasServicePrincipal = !!(
    config.tenantId &&
    config.clientId &&
    config.clientSecret &&
    config.accountName
  )

  if (
    !hasConnectionString &&
    !hasAccountKey &&
    !hasSasToken &&
    !hasServicePrincipal
  ) {
    errors.push('No valid Azure Storage credentials provided')
  }

  if (!config.containerName || !isValidContainerName(config.containerName)) {
    errors.push('Invalid container name')
  }

  if (
    !config.stagingContainer ||
    !isValidContainerName(config.stagingContainer)
  ) {
    errors.push('Invalid staging container name')
  }

  if (
    !config.archiveContainer ||
    !isValidContainerName(config.archiveContainer)
  ) {
    errors.push('Invalid archive container name')
  }

  if (
    config.maxFileSize &&
    (typeof config.maxFileSize !== 'number' || config.maxFileSize <= 0)
  ) {
    errors.push('Invalid maxFileSize - must be a positive number')
  }

  if (
    config.blockSize &&
    (typeof config.blockSize !== 'number' || config.blockSize <= 0)
  ) {
    errors.push('Invalid blockSize - must be a positive number')
  }

  if (
    config.maxConcurrency &&
    (typeof config.maxConcurrency !== 'number' || config.maxConcurrency <= 0)
  ) {
    errors.push('Invalid maxConcurrency - must be a positive number')
  }

  if (
    config.maxRetries &&
    (typeof config.maxRetries !== 'number' || config.maxRetries < 0)
  ) {
    errors.push('Invalid maxRetries - must be a non-negative number')
  }

  if (config.blockSize && config.blockSize > 100 * 1024 * 1024) {
    warnings.push('Block size is very large (>100MB) - may impact performance')
  }

  if (config.maxConcurrency && config.maxConcurrency > 10) {
    warnings.push('High concurrency setting (>10) - monitor resource usage')
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

function isValidContainerName(name) {
  const containerNameRegex = /^[a-z0-9]([a-z0-9]|[-](?!-))*[a-z0-9]$|^[a-z0-9]$/
  return (
    name &&
    name.length >= 3 &&
    name.length <= 63 &&
    containerNameRegex.test(name)
  )
}
export default {
  initialize,
  get,
  getAll,
  getConnectionType,
  getContainerName,
  getStagingContainer,
  getArchiveContainer,
  getRetryConfig,
  getHealthStatus,
  isInitialized,
  reset
}
