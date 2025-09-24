import fileProcessingPipeline from '../services/file-processing-pipeline.js'
import azureStorageService from '../services/azure-storage-service.js'
import { logger } from '../common/helpers/logging/logger.js'
import { config } from '../../config/config.js'

const state = {
  processingStats: {
    totalProcessed: 0,
    successfulUploads: 0,
    failedUploads: 0,
    averageProcessingTime: 0,
    lastProcessedAt: null
  },
  isEnabled: config.get('azureStorage.enabled')
}

export async function processUploadCallback(
  callbackData,
  request = null,
  formData = null
) {
  if (!state.isEnabled) {
    logger.debug('Azure Storage is disabled, skipping Azure processing')
    return { success: true, skipped: true, reason: 'Azure Storage disabled' }
  }

  const { uploadId, status } = callbackData
  const startTime = Date.now()

  try {
    logger.info('Starting Azure upload callback processing', {
      uploadId,
      status,
      azureEnabled: state.isEnabled
    })

    if (status !== 'completed') {
      logger.debug('Skipping Azure processing for non-completed upload', {
        uploadId,
        status
      })
      return {
        success: true,
        skipped: true,
        reason: `Upload status is ${status}, not completed`
      }
    }

    await azureStorageService.initialize()

    const result = await fileProcessingPipeline.processUploadedFile(
      callbackData,
      formData
    )

    updateStats(result, Date.now() - startTime)

    if (result.success) {
      logger.info('Azure upload callback processing completed successfully', {
        uploadId,
        processingId: result.processingId,
        processedFileCount: result.processedFiles?.length || 0,
        processingTime: result.processingTime
      })
    } else {
      logger.error('Azure upload callback processing failed', {
        uploadId,
        processingId: result.processingId,
        errorCount: result.errors?.length || 0,
        processingTime: result.processingTime
      })
    }

    return result
  } catch (error) {
    const processingTime = Date.now() - startTime

    logger.error('Azure upload callback handler error', {
      uploadId,
      error: error.message,
      stack: error.stack,
      processingTime
    })

    updateStats({ success: false }, processingTime)

    return {
      success: false,
      error: error.message,
      processingTime,
      failedAt: new Date().toISOString()
    }
  }
}

function updateStats(result, processingTime) {
  state.processingStats.totalProcessed++
  state.processingStats.lastProcessedAt = new Date().toISOString()

  if (result.success) {
    state.processingStats.successfulUploads++
  } else {
    state.processingStats.failedUploads++
  }

  const currentAvg = state.processingStats.averageProcessingTime
  const totalProcessed = state.processingStats.totalProcessed
  state.processingStats.averageProcessingTime =
    (currentAvg * (totalProcessed - 1) + processingTime) / totalProcessed
}

export function getMetrics() {
  return {
    enabled: state.isEnabled,
    stats: {
      ...state.processingStats,
      successRate:
        state.processingStats.totalProcessed > 0
          ? (state.processingStats.successfulUploads /
              state.processingStats.totalProcessed) *
            100
          : 0
    },
    azure: state.isEnabled
      ? {
          storageService: azureStorageService.getStorageMetrics(),
          pipeline: fileProcessingPipeline.getHealthMetrics()
        }
      : null,
    timestamp: new Date().toISOString()
  }
}

export function resetStats() {
  state.processingStats = {
    totalProcessed: 0,
    successfulUploads: 0,
    failedUploads: 0,
    averageProcessingTime: 0,
    lastProcessedAt: null
  }
}

export async function checkHealth() {
  try {
    if (!state.isEnabled) {
      return {
        healthy: true,
        status: 'disabled',
        message: 'Azure Storage is disabled'
      }
    }

    const azureHealth = await azureStorageService.checkConnectionHealth()

    return {
      healthy: azureHealth.healthy,
      status: azureHealth.healthy ? 'healthy' : 'unhealthy',
      azureStorage: azureHealth,
      stats: state.processingStats,
      message: azureHealth.healthy
        ? 'Azure handler is healthy'
        : 'Azure storage connection issues'
    }
  } catch (error) {
    logger.error('Azure handler health check failed', {
      error: error.message,
      stack: error.stack
    })

    return {
      healthy: false,
      status: 'error',
      error: error.message,
      message: 'Azure handler health check failed'
    }
  }
}

export function setEnabled(enabled) {
  const wasEnabled = state.isEnabled
  state.isEnabled = enabled

  logger.info('Azure handler enabled status changed', {
    wasEnabled,
    nowEnabled: enabled
  })

  return {
    wasEnabled,
    nowEnabled: enabled,
    changedAt: new Date().toISOString()
  }
}

export default {
  processUploadCallback,
  getMetrics,
  resetStats,
  checkHealth,
  setEnabled
}
