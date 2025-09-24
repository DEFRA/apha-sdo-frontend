import azureConfig from './azureConfig.js'
import azureStorageService from './azure-storage-service.js'
import { logger } from '../common/helpers/logging/logger.js'

// Private state for Azure initialization
const initializerState = {
  initialized: false,
  initializationAttempted: false,
  initializationPromise: null,
  initializationResults: null
}

export async function initialize() {
  if (initializerState.initializationPromise) {
    return initializerState.initializationPromise
  }

  if (initializerState.initialized) {
    return initializerState.initializationResults
  }

  initializerState.initializationPromise = performInitialization()
  return initializerState.initializationPromise
}

export function isInitialized() {
  return initializerState.initialized
}

export function getInitializationStatus() {
  return {
    initialized: initializerState.initialized,
    attempted: initializerState.initializationAttempted,
    results: initializerState.initializationResults
  }
}

export async function reinitialize() {
  initializerState.initialized = false
  initializerState.initializationAttempted = false
  initializerState.initializationPromise = null
  initializerState.initializationResults = null

  return initialize()
}

async function performInitialization() {
  initializerState.initializationAttempted = true

  const results = {
    success: false,
    services: {
      config: { initialized: false, error: null },
      storage: { initialized: false, error: null }
    },
    timestamp: new Date().toISOString()
  }

  try {
    logger.info('Starting Azure services initialization')

    try {
      const configResult = await azureConfig.initialize()
      results.services.config = {
        initialized: configResult.success,
        error: configResult.success
          ? null
          : 'Configuration initialization failed'
      }
    } catch (error) {
      results.services.config = {
        initialized: false,
        error: error.message
      }
      logger.error('Azure config initialization failed', {
        error: error.message
      })
    }

    if (results.services.config.initialized) {
      try {
        await azureStorageService.initialize()
        results.services.storage = {
          initialized: true,
          error: null
        }
      } catch (error) {
        results.services.storage = {
          initialized: false,
          error: error.message
        }
        logger.error('Azure storage service initialization failed', {
          error: error.message
        })
      }
    } else {
      results.services.storage = {
        initialized: false,
        error: 'Skipped due to config initialization failure'
      }
    }

    results.success =
      results.services.config.initialized &&
      results.services.storage.initialized

    initializerState.initialized = results.success
    initializerState.initializationResults = results

    if (results.success) {
      logger.info('Azure services initialization completed successfully')
    } else {
      logger.warn('Azure services initialization completed with errors', {
        configInitialized: results.services.config.initialized,
        storageInitialized: results.services.storage.initialized
      })
    }

    return results
  } catch (error) {
    logger.error('Azure services initialization failed', {
      error: error.message,
      stack: error.stack
    })

    results.success = false
    results.error = error.message
    initializerState.initializationResults = results

    throw error
  }
}
export default {
  initialize,
  isInitialized,
  getInitializationStatus,
  reinitialize
}
