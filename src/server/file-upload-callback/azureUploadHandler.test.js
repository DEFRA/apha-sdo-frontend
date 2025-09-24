import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import fileProcessingPipeline from '../services/file-processing-pipeline.js'
import azureStorageService from '../services/azure-storage-service.js'
import { logger } from '../common/helpers/logging/logger.js'
import { config } from '../../config/config.js'

vi.mock('../services/file-processing-pipeline.js', () => ({
  default: {
    processUploadedFile: vi.fn(),
    getHealthMetrics: vi.fn()
  }
}))

vi.mock('../services/azure-storage-service.js', () => ({
  default: {
    initialize: vi.fn(),
    getStorageMetrics: vi.fn(),
    checkConnectionHealth: vi.fn()
  }
}))

vi.mock('../common/helpers/logging/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}))

vi.mock('../../config/config.js', () => ({
  config: {
    get: vi.fn()
  }
}))

describe('Azure Upload Handler', () => {
  let azureUploadHandler

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks()

    // Default config mock - enable Azure by default
    config.get.mockImplementation((key) => {
      if (key === 'azureStorage.enabled') return true
      return {}
    })

    // Clear module cache and re-import to get fresh state
    vi.resetModules()
    azureUploadHandler = await import('./azureUploadHandler.js')

    // Reset stats
    azureUploadHandler.resetStats()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('processUploadCallback', () => {
    const mockCallbackData = {
      uploadId: 'test-upload-123',
      status: 'completed',
      files: [
        {
          filename: 'test-file.pdf',
          originalFilename: 'document.pdf',
          size: 12345
        }
      ]
    }

    const mockFormData = {
      submissionId: 'sub-123',
      metadata: { type: 'test-document' }
    }

    it('should successfully process completed upload with form data', async () => {
      // Setup mocks
      azureStorageService.initialize.mockResolvedValue()
      fileProcessingPipeline.processUploadedFile.mockResolvedValue({
        success: true,
        processingId: 'proc-456',
        processedFiles: [{ filename: 'test-file.pdf' }],
        processingTime: 1500
      })

      // Execute
      const result = await azureUploadHandler.processUploadCallback(
        mockCallbackData,
        null,
        mockFormData
      )

      // Verify
      expect(azureStorageService.initialize).toHaveBeenCalledOnce()
      expect(fileProcessingPipeline.processUploadedFile).toHaveBeenCalledWith(
        mockCallbackData,
        mockFormData
      )
      expect(result.success).toBe(true)
      expect(result.processingId).toBe('proc-456')
      expect(logger.info).toHaveBeenCalledWith(
        'Starting Azure upload callback processing',
        expect.objectContaining({
          uploadId: 'test-upload-123',
          status: 'completed',
          azureEnabled: true
        })
      )
      expect(logger.info).toHaveBeenCalledWith(
        'Azure upload callback processing completed successfully',
        expect.objectContaining({
          uploadId: 'test-upload-123',
          processingId: 'proc-456',
          processedFileCount: 1
        })
      )
    })

    it('should skip processing when Azure Storage is disabled', async () => {
      // Setup - disable Azure storage
      config.get.mockImplementation((key) => {
        if (key === 'azureStorage.enabled') return false
        return {}
      })

      // Create new handler instance with disabled Azure
      vi.resetModules()
      const disabledHandler = await import('./azureUploadHandler.js')

      // Execute
      const result =
        await disabledHandler.processUploadCallback(mockCallbackData)

      // Verify
      expect(result).toEqual({
        success: true,
        skipped: true,
        reason: 'Azure Storage disabled'
      })
      expect(azureStorageService.initialize).not.toHaveBeenCalled()
      expect(fileProcessingPipeline.processUploadedFile).not.toHaveBeenCalled()
      expect(logger.debug).toHaveBeenCalledWith(
        'Azure Storage is disabled, skipping Azure processing'
      )
    })

    it('should skip processing for non-completed uploads', async () => {
      // Setup - non-completed status
      const incompleteCallbackData = {
        ...mockCallbackData,
        status: 'processing'
      }

      // Execute
      const result = await azureUploadHandler.processUploadCallback(
        incompleteCallbackData
      )

      // Verify
      expect(result).toEqual({
        success: true,
        skipped: true,
        reason: 'Upload status is processing, not completed'
      })
      expect(azureStorageService.initialize).not.toHaveBeenCalled()
      expect(fileProcessingPipeline.processUploadedFile).not.toHaveBeenCalled()
      expect(logger.debug).toHaveBeenCalledWith(
        'Skipping Azure processing for non-completed upload',
        expect.objectContaining({
          uploadId: 'test-upload-123',
          status: 'processing'
        })
      )
    })

    it('should handle failed processing result', async () => {
      // Setup mocks
      azureStorageService.initialize.mockResolvedValue()
      fileProcessingPipeline.processUploadedFile.mockResolvedValue({
        success: false,
        processingId: 'proc-789',
        errors: [{ message: 'Processing failed' }],
        processingTime: 2000
      })

      // Execute
      const result =
        await azureUploadHandler.processUploadCallback(mockCallbackData)

      // Verify
      expect(result.success).toBe(false)
      expect(result.processingId).toBe('proc-789')
      expect(logger.error).toHaveBeenCalledWith(
        'Azure upload callback processing failed',
        expect.objectContaining({
          uploadId: 'test-upload-123',
          processingId: 'proc-789',
          errorCount: 1
        })
      )
    })

    it('should handle Azure service initialization error', async () => {
      // Setup - mock initialization failure
      const initError = new Error('Azure initialization failed')
      azureStorageService.initialize.mockRejectedValue(initError)

      // Execute
      const result =
        await azureUploadHandler.processUploadCallback(mockCallbackData)

      // Verify
      expect(result.success).toBe(false)
      expect(result.error).toBe('Azure initialization failed')
      expect(result).toHaveProperty('processingTime')
      expect(result).toHaveProperty('failedAt')
      expect(logger.error).toHaveBeenCalledWith(
        'Azure upload callback handler error',
        expect.objectContaining({
          uploadId: 'test-upload-123',
          error: 'Azure initialization failed'
        })
      )
    })

    it('should handle file processing pipeline error', async () => {
      // Setup mocks
      azureStorageService.initialize.mockResolvedValue()
      const processingError = new Error('File processing failed')
      fileProcessingPipeline.processUploadedFile.mockRejectedValue(
        processingError
      )

      // Execute
      const result =
        await azureUploadHandler.processUploadCallback(mockCallbackData)

      // Verify
      expect(result.success).toBe(false)
      expect(result.error).toBe('File processing failed')
      expect(result).toHaveProperty('processingTime')
      expect(result).toHaveProperty('failedAt')
      expect(logger.error).toHaveBeenCalledWith(
        'Azure upload callback handler error',
        expect.objectContaining({
          uploadId: 'test-upload-123',
          error: 'File processing failed',
          stack: expect.any(String)
        })
      )
    })

    it('should update statistics correctly on success', async () => {
      // Setup mocks
      azureStorageService.initialize.mockResolvedValue()
      fileProcessingPipeline.processUploadedFile.mockResolvedValue({
        success: true,
        processingId: 'proc-456',
        processedFiles: [{ filename: 'test-file.pdf' }],
        processingTime: 1000
      })

      // Execute
      await azureUploadHandler.processUploadCallback(mockCallbackData)

      // Verify statistics were updated
      const metrics = azureUploadHandler.getMetrics()
      expect(metrics.stats.totalProcessed).toBe(1)
      expect(metrics.stats.successfulUploads).toBe(1)
      expect(metrics.stats.failedUploads).toBe(0)
      expect(metrics.stats.successRate).toBe(100)
      expect(metrics.stats.lastProcessedAt).toBeTruthy()
      expect(metrics.stats.averageProcessingTime).toBeGreaterThanOrEqual(0)
    })

    it('should update statistics correctly on failure', async () => {
      // Setup - mock failure
      azureStorageService.initialize.mockRejectedValue(new Error('Test error'))

      // Execute
      await azureUploadHandler.processUploadCallback(mockCallbackData)

      // Verify statistics were updated
      const metrics = azureUploadHandler.getMetrics()
      expect(metrics.stats.totalProcessed).toBe(1)
      expect(metrics.stats.successfulUploads).toBe(0)
      expect(metrics.stats.failedUploads).toBe(1)
      expect(metrics.stats.successRate).toBe(0)
      expect(metrics.stats.lastProcessedAt).toBeTruthy()
    })

    it('should handle missing uploadId gracefully', async () => {
      // Setup - callback data without uploadId
      const incompleteCallbackData = {
        status: 'completed',
        files: []
      }

      azureStorageService.initialize.mockResolvedValue()
      fileProcessingPipeline.processUploadedFile.mockResolvedValue({
        success: true,
        processingId: 'proc-456'
      })

      // Execute
      const result = await azureUploadHandler.processUploadCallback(
        incompleteCallbackData
      )

      // Verify it processes without crashing
      expect(result.success).toBe(true)
      expect(logger.info).toHaveBeenCalledWith(
        'Starting Azure upload callback processing',
        expect.objectContaining({
          uploadId: undefined,
          status: 'completed'
        })
      )
    })
  })

  describe('getMetrics', () => {
    it('should return correct metrics when Azure is enabled', () => {
      // Setup mocks
      azureStorageService.getStorageMetrics.mockReturnValue({
        connectionStatus: 'healthy',
        operationsCount: 10
      })
      fileProcessingPipeline.getHealthMetrics.mockReturnValue({
        activeProcesses: 2,
        queueLength: 0
      })

      // Execute
      const metrics = azureUploadHandler.getMetrics()

      // Verify
      expect(metrics.enabled).toBe(true)
      expect(metrics.azure).toBeTruthy()
      expect(metrics.azure.storageService).toEqual({
        connectionStatus: 'healthy',
        operationsCount: 10
      })
      expect(metrics.azure.pipeline).toEqual({
        activeProcesses: 2,
        queueLength: 0
      })
      expect(metrics.stats).toHaveProperty('totalProcessed')
      expect(metrics.stats).toHaveProperty('successfulUploads')
      expect(metrics.stats).toHaveProperty('failedUploads')
      expect(metrics.stats).toHaveProperty('successRate')
      expect(metrics.timestamp).toBeTruthy()
    })

    it('should return correct metrics when Azure is disabled', () => {
      // Setup - disable Azure
      azureUploadHandler.setEnabled(false)

      // Execute
      const metrics = azureUploadHandler.getMetrics()

      // Verify
      expect(metrics.enabled).toBe(false)
      expect(metrics.azure).toBe(null)
      expect(metrics.stats).toHaveProperty('totalProcessed')
      expect(metrics.timestamp).toBeTruthy()
    })

    it('should calculate success rate correctly', async () => {
      // Setup - simulate some processing
      azureUploadHandler.resetStats()

      // Mock successful processing
      azureStorageService.initialize.mockResolvedValue()
      fileProcessingPipeline.processUploadedFile
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false })

      // Execute multiple processes
      await Promise.all([
        azureUploadHandler.processUploadCallback({
          uploadId: '1',
          status: 'completed'
        }),
        azureUploadHandler.processUploadCallback({
          uploadId: '2',
          status: 'completed'
        }),
        azureUploadHandler.processUploadCallback({
          uploadId: '3',
          status: 'completed'
        })
      ])

      const metrics = azureUploadHandler.getMetrics()
      expect(metrics.stats.totalProcessed).toBe(3)
      expect(metrics.stats.successfulUploads).toBe(2)
      expect(metrics.stats.failedUploads).toBe(1)
      expect(metrics.stats.successRate).toBeCloseTo(66.67, 1)
    })
  })

  describe('resetStats', () => {
    it('should reset all statistics to initial values', async () => {
      // Setup - process something to have stats
      azureStorageService.initialize.mockResolvedValue()
      fileProcessingPipeline.processUploadedFile.mockResolvedValue({
        success: true
      })

      await azureUploadHandler.processUploadCallback({
        uploadId: 'test',
        status: 'completed'
      })

      // Verify stats exist
      let metrics = azureUploadHandler.getMetrics()
      expect(metrics.stats.totalProcessed).toBe(1)

      // Execute reset
      azureUploadHandler.resetStats()

      // Verify reset
      metrics = azureUploadHandler.getMetrics()
      expect(metrics.stats.totalProcessed).toBe(0)
      expect(metrics.stats.successfulUploads).toBe(0)
      expect(metrics.stats.failedUploads).toBe(0)
      expect(metrics.stats.averageProcessingTime).toBe(0)
      expect(metrics.stats.lastProcessedAt).toBe(null)
    })
  })

  describe('checkHealth', () => {
    it('should return healthy status when Azure is enabled and connection is good', async () => {
      // Setup mocks
      azureStorageService.checkConnectionHealth.mockResolvedValue({
        healthy: true,
        connectionStatus: 'connected',
        responseTime: 50
      })

      // Execute
      const health = await azureUploadHandler.checkHealth()

      // Verify
      expect(health.healthy).toBe(true)
      expect(health.status).toBe('healthy')
      expect(health.message).toBe('Azure handler is healthy')
      expect(health.azureStorage).toEqual({
        healthy: true,
        connectionStatus: 'connected',
        responseTime: 50
      })
      expect(health.stats).toBeTruthy()
    })

    it('should return disabled status when Azure is disabled', async () => {
      // Setup - disable Azure
      azureUploadHandler.setEnabled(false)

      // Execute
      const health = await azureUploadHandler.checkHealth()

      // Verify
      expect(health.healthy).toBe(true)
      expect(health.status).toBe('disabled')
      expect(health.message).toBe('Azure Storage is disabled')
      expect(azureStorageService.checkConnectionHealth).not.toHaveBeenCalled()
    })

    it('should return unhealthy status when Azure connection fails', async () => {
      // Setup mocks
      azureStorageService.checkConnectionHealth.mockResolvedValue({
        healthy: false,
        connectionStatus: 'connection_failed',
        error: 'Network timeout'
      })

      // Execute
      const health = await azureUploadHandler.checkHealth()

      // Verify
      expect(health.healthy).toBe(false)
      expect(health.status).toBe('unhealthy')
      expect(health.message).toBe('Azure storage connection issues')
      expect(health.azureStorage.healthy).toBe(false)
    })

    it('should handle health check errors gracefully', async () => {
      // Setup - mock health check error
      const healthError = new Error('Health check failed')
      azureStorageService.checkConnectionHealth.mockRejectedValue(healthError)

      // Execute
      const health = await azureUploadHandler.checkHealth()

      // Verify
      expect(health.healthy).toBe(false)
      expect(health.status).toBe('error')
      expect(health.error).toBe('Health check failed')
      expect(health.message).toBe('Azure handler health check failed')
      expect(logger.error).toHaveBeenCalledWith(
        'Azure handler health check failed',
        expect.objectContaining({
          error: 'Health check failed',
          stack: expect.any(String)
        })
      )
    })
  })

  describe('setEnabled', () => {
    it('should enable Azure processing when currently disabled', () => {
      // Setup - start disabled
      azureUploadHandler.setEnabled(false)

      // Execute
      const result = azureUploadHandler.setEnabled(true)

      expect(result.wasEnabled).toBe(false)
      expect(result.nowEnabled).toBe(true)
      expect(result.changedAt).toBeTruthy()
      expect(logger.info).toHaveBeenCalledWith(
        'Azure handler enabled status changed',
        {
          wasEnabled: false,
          nowEnabled: true
        }
      )

      const metrics = azureUploadHandler.getMetrics()
      expect(metrics.enabled).toBe(true)
    })

    it('should disable Azure processing when currently enabled', () => {
      azureUploadHandler.setEnabled(true)

      const result = azureUploadHandler.setEnabled(false)

      expect(result.wasEnabled).toBe(true)
      expect(result.nowEnabled).toBe(false)
      expect(result.changedAt).toBeTruthy()
      expect(logger.info).toHaveBeenCalledWith(
        'Azure handler enabled status changed',
        {
          wasEnabled: true,
          nowEnabled: false
        }
      )

      const metrics = azureUploadHandler.getMetrics()
      expect(metrics.enabled).toBe(false)
    })

    it('should return correct status when no change occurs', () => {
      azureUploadHandler.setEnabled(true)
      vi.clearAllMocks()

      const result = azureUploadHandler.setEnabled(true)
      expect(result.wasEnabled).toBe(true)
      expect(result.nowEnabled).toBe(true)
      expect(result.changedAt).toBeTruthy()
      expect(logger.info).toHaveBeenCalledWith(
        'Azure handler enabled status changed',
        {
          wasEnabled: true,
          nowEnabled: true
        }
      )
    })
  })

  describe('error edge cases', () => {
    it('should handle null callback data', async () => {
      // Execute with null callback data - should handle destructuring error
      const result = await azureUploadHandler
        .processUploadCallback(null)
        .catch((err) => ({
          success: false,
          error: err.message
        }))

      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
    })

    it('should handle empty callback data', async () => {
      // Execute with empty object
      const result = await azureUploadHandler.processUploadCallback({})

      expect(result.success).toBe(true)
      expect(result.skipped).toBe(true)
      expect(result.reason).toContain('not completed')
    })

    it('should handle very long processing times in average calculation', async () => {
      // Setup
      azureStorageService.initialize.mockResolvedValue()
      fileProcessingPipeline.processUploadedFile.mockImplementation(() => {
        // Simulate long processing time
        return new Promise((resolve) => {
          setTimeout(() => resolve({ success: true }), 100)
        })
      })

      // Execute
      await azureUploadHandler.processUploadCallback({
        uploadId: 'test',
        status: 'completed'
      })

      const metrics = azureUploadHandler.getMetrics()
      expect(metrics.stats.averageProcessingTime).toBeGreaterThan(90)
    })

    it('should handle concurrent processing requests', async () => {
      // Setup
      azureStorageService.initialize.mockResolvedValue()
      fileProcessingPipeline.processUploadedFile.mockResolvedValue({
        success: true
      })

      // Execute multiple concurrent requests
      const promises = Array.from({ length: 5 }, (_, i) =>
        azureUploadHandler.processUploadCallback({
          uploadId: `test-${i}`,
          status: 'completed'
        })
      )

      const results = await Promise.all(promises)

      results.forEach((result) => {
        expect(result.success).toBe(true)
      })

      const metrics = azureUploadHandler.getMetrics()
      expect(metrics.stats.totalProcessed).toBe(5)
      expect(metrics.stats.successfulUploads).toBe(5)
    })
  })
})
