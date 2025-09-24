import { beforeEach, describe, expect, it, vi } from 'vitest'
import Boom from '@hapi/boom'
import { fileUploadCallbackController } from './controller.js'

import uploadService from '../services/upload-service.js'
import azureUploadHandler from './azureUploadHandler.js'
import uploadSessionManager from '../services/upload-session-manager.js'
import { config } from '../../config/config.js'
import { logger } from '../common/helpers/logging/logger.js'

vi.mock('../services/upload-service.js', () => ({
  default: {
    processUploadCallback: vi.fn(),
    getHealthMetrics: vi.fn(),
    getUploadStatus: vi.fn()
  }
}))

vi.mock('./azureUploadHandler.js', () => ({
  default: {
    processUploadCallback: vi.fn(),
    getMetrics: vi.fn()
  }
}))

vi.mock('../services/upload-session-manager.js', () => ({
  default: {
    getFormData: vi.fn()
  }
}))

vi.mock('../../config/config.js', () => ({
  config: {
    get: vi.fn()
  }
}))

vi.mock('../common/helpers/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

describe('fileUploadCallbackController', () => {
  let mockRequest
  let mockH

  beforeEach(() => {
    vi.clearAllMocks()

    mockRequest = {
      payload: {
        uploadId: 'test-upload-123',
        status: 'completed',
        retrievalKey: 'test-key-456'
      },
      info: {
        remoteAddress: '127.0.0.1'
      },
      headers: {}
    }

    mockH = {
      response: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis()
    }

    config.get.mockImplementation((key) => {
      switch (key) {
        case 'azureStorage.enabled':
          return false
        case 'azureStorage.enableBackgroundProcessing':
          return false
        default:
          return null
      }
    })
  })

  describe('handler', () => {
    describe('successful processing', () => {
      it('should process valid callback successfully', async () => {
        uploadService.processUploadCallback.mockResolvedValue({
          success: true,
          message: 'Upload processed successfully'
        })

        await fileUploadCallbackController.handler(mockRequest, mockH)
        expect(uploadService.processUploadCallback).toHaveBeenCalledWith(
          mockRequest.payload,
          mockRequest
        )
        expect(mockH.response).toHaveBeenCalledWith({
          success: true,
          message: 'Callback processed successfully'
        })
        expect(mockH.code).toHaveBeenCalledWith(200)
        expect(logger.info).toHaveBeenCalledWith(
          'Received file upload callback',
          {
            uploadId: 'test-upload-123',
            status: 'completed',
            retrievalKey: 'test-key-456'
          }
        )
      })

      it('should handle callback failure from upload service', async () => {
        uploadService.processUploadCallback.mockResolvedValue({
          success: false,
          error: 'File validation failed'
        })

        await fileUploadCallbackController.handler(mockRequest, mockH)
        expect(mockH.response).toHaveBeenCalledWith({
          success: false,
          error: 'File validation failed'
        })
        expect(mockH.code).toHaveBeenCalledWith(400)
        expect(logger.error).toHaveBeenCalledWith(
          'Callback processing failed',
          {
            uploadId: 'test-upload-123',
            error: 'File validation failed'
          }
        )
      })
    })

    describe('validation', () => {
      it('should return Boom.badRequest when uploadId is missing', async () => {
        mockRequest.payload = { status: 'completed' }

        const result = await fileUploadCallbackController.handler(
          mockRequest,
          mockH
        )
        expect(result).toEqual(Boom.badRequest('Invalid callback payload'))
        expect(logger.error).toHaveBeenCalledWith(
          'Invalid callback payload - missing required fields',
          {
            payload: { status: 'completed' }
          }
        )
        expect(uploadService.processUploadCallback).not.toHaveBeenCalled()
      })

      it('should return Boom.badRequest when status is missing', async () => {
        mockRequest.payload = { uploadId: 'test-upload-123' }

        const result = await fileUploadCallbackController.handler(
          mockRequest,
          mockH
        )
        expect(result).toEqual(Boom.badRequest('Invalid callback payload'))
        expect(logger.error).toHaveBeenCalledWith(
          'Invalid callback payload - missing required fields',
          {
            payload: { uploadId: 'test-upload-123' }
          }
        )
        expect(uploadService.processUploadCallback).not.toHaveBeenCalled()
      })

      it('should return Boom.badRequest when payload is null', async () => {
        mockRequest.payload = null

        const result = await fileUploadCallbackController.handler(
          mockRequest,
          mockH
        )
        expect(result).toEqual(Boom.badRequest('Invalid callback payload'))
        expect(uploadService.processUploadCallback).not.toHaveBeenCalled()
      })

      it('should return Boom.badRequest when payload is undefined', async () => {
        mockRequest.payload = undefined

        const result = await fileUploadCallbackController.handler(
          mockRequest,
          mockH
        )
        expect(result).toEqual(Boom.badRequest('Invalid callback payload'))
        expect(uploadService.processUploadCallback).not.toHaveBeenCalled()
      })
    })

    describe('Azure handler integration', () => {
      beforeEach(() => {
        uploadService.processUploadCallback.mockResolvedValue({
          success: true,
          message: 'Upload processed successfully'
        })
      })

      describe('background processing', () => {
        it('should process Azure callback in background when enabled', async () => {
          config.get.mockImplementation((key) => {
            switch (key) {
              case 'azureStorage.enabled':
                return true
              case 'azureStorage.enableBackgroundProcessing':
                return true
              default:
                return null
            }
          })

          const mockFormData = { field1: 'value1', field2: 'value2' }
          uploadSessionManager.getFormData.mockReturnValue(mockFormData)
          azureUploadHandler.processUploadCallback.mockResolvedValue({
            success: true,
            azureUploadId: 'azure-123'
          })

          await fileUploadCallbackController.handler(mockRequest, mockH)
          expect(uploadSessionManager.getFormData).toHaveBeenCalledWith(
            'test-upload-123'
          )
          expect(mockH.response).toHaveBeenCalledWith({
            success: true,
            message: 'Callback processed successfully'
          })
          expect(mockH.code).toHaveBeenCalledWith(200)

          await new Promise((resolve) => setImmediate(resolve))

          expect(azureUploadHandler.processUploadCallback).toHaveBeenCalledWith(
            mockRequest.payload,
            mockRequest,
            mockFormData
          )
        })

        it('should log error when background Azure processing fails but not fail the main callback', async () => {
          config.get.mockImplementation((key) => {
            switch (key) {
              case 'azureStorage.enabled':
                return true
              case 'azureStorage.enableBackgroundProcessing':
                return true
              default:
                return null
            }
          })

          uploadSessionManager.getFormData.mockReturnValue(null)
          azureUploadHandler.processUploadCallback.mockRejectedValue(
            new Error('Azure connection failed')
          )

          await fileUploadCallbackController.handler(mockRequest, mockH)
          expect(mockH.code).toHaveBeenCalledWith(200)

          await new Promise((resolve) => setImmediate(resolve))

          expect(logger.error).toHaveBeenCalledWith(
            'Azure background processing failed',
            {
              uploadId: 'test-upload-123',
              error: 'Azure connection failed'
            }
          )
        })
      })

      describe('synchronous processing', () => {
        it('should process Azure callback synchronously when background processing is disabled', async () => {
          config.get.mockImplementation((key) => {
            switch (key) {
              case 'azureStorage.enabled':
                return true
              case 'azureStorage.enableBackgroundProcessing':
                return false
              default:
                return null
            }
          })

          const mockFormData = { field1: 'value1' }
          uploadSessionManager.getFormData.mockReturnValue(mockFormData)
          azureUploadHandler.processUploadCallback.mockResolvedValue({
            success: true,
            azureUploadId: 'azure-456'
          })

          await fileUploadCallbackController.handler(mockRequest, mockH)
          expect(azureUploadHandler.processUploadCallback).toHaveBeenCalledWith(
            mockRequest.payload,
            mockRequest,
            mockFormData
          )
          expect(logger.info).toHaveBeenCalledWith(
            'Azure processing completed synchronously',
            {
              uploadId: 'test-upload-123',
              azureSuccess: true,
              hasFormData: true
            }
          )
          expect(mockH.code).toHaveBeenCalledWith(200)
        })

        it('should return error when synchronous Azure processing fails', async () => {
          config.get.mockImplementation((key) => {
            switch (key) {
              case 'azureStorage.enabled':
                return true
              case 'azureStorage.enableBackgroundProcessing':
                return false
              default:
                return null
            }
          })

          uploadService.processUploadCallback.mockResolvedValue({
            success: true
          })
          uploadSessionManager.getFormData.mockReturnValue(null)
          azureUploadHandler.processUploadCallback.mockRejectedValue(
            new Error('Azure storage unavailable')
          )

          await fileUploadCallbackController.handler(mockRequest, mockH)
          expect(logger.error).toHaveBeenCalledWith('Azure processing failed', {
            uploadId: 'test-upload-123',
            error: 'Azure storage unavailable',
            stack: expect.any(String)
          })
          expect(mockH.response).toHaveBeenCalledWith({
            success: false,
            error: 'Azure processing failed',
            details: 'Azure storage unavailable'
          })
          expect(mockH.code).toHaveBeenCalledWith(500)
        })
      })

      it('should handle form data retrieval failure gracefully', async () => {
        config.get.mockImplementation((key) => {
          switch (key) {
            case 'azureStorage.enabled':
              return true
            case 'azureStorage.enableBackgroundProcessing':
              return false
            default:
              return null
          }
        })

        uploadSessionManager.getFormData.mockImplementation(() => {
          throw new Error('Session expired')
        })
        azureUploadHandler.processUploadCallback.mockResolvedValue({
          success: true
        })

        await fileUploadCallbackController.handler(mockRequest, mockH)
        expect(logger.warn).toHaveBeenCalledWith(
          'Could not retrieve form data from session',
          {
            uploadId: 'test-upload-123',
            error: 'Session expired'
          }
        )
        expect(azureUploadHandler.processUploadCallback).toHaveBeenCalledWith(
          mockRequest.payload,
          mockRequest,
          null
        )
        expect(mockH.code).toHaveBeenCalledWith(200)
      })
    })

    describe('error handling', () => {
      it('should return Boom.internal when upload service throws an error', async () => {
        uploadService.processUploadCallback.mockRejectedValue(
          new Error('Database connection failed')
        )

        const result = await fileUploadCallbackController.handler(
          mockRequest,
          mockH
        )
        expect(result).toEqual(Boom.internal('Callback processing error'))
        expect(logger.error).toHaveBeenCalledWith('Callback handler error', {
          error: 'Database connection failed',
          stack: expect.any(String),
          uploadId: 'test-upload-123'
        })
      })

      it('should handle errors when payload is null and uploadId is not accessible', async () => {
        mockRequest.payload = null
        uploadService.processUploadCallback.mockRejectedValue(
          new Error('Unexpected error')
        )

        const result = await fileUploadCallbackController.handler(
          mockRequest,
          mockH
        )
        expect(result).toEqual(Boom.badRequest('Invalid callback payload'))
      })

      it('should handle timeout errors appropriately', async () => {
        const timeoutError = new Error('Request timeout')
        timeoutError.code = 'TIMEOUT'
        uploadService.processUploadCallback.mockRejectedValue(timeoutError)

        const result = await fileUploadCallbackController.handler(
          mockRequest,
          mockH
        )
        expect(result).toEqual(Boom.internal('Callback processing error'))
        expect(logger.error).toHaveBeenCalledWith('Callback handler error', {
          error: 'Request timeout',
          stack: expect.any(String),
          uploadId: 'test-upload-123'
        })
      })
    })
  })

  describe('healthHandler', () => {
    it('should return healthy status with timestamp', async () => {
      const mockDate = new Date('2023-12-01T10:00:00.000Z')
      vi.setSystemTime(mockDate)

      await fileUploadCallbackController.healthHandler(mockRequest, mockH)
      expect(mockH.response).toHaveBeenCalledWith({
        status: 'healthy',
        timestamp: '2023-12-01T10:00:00.000Z',
        service: 'file-upload-callback'
      })
      expect(mockH.code).toHaveBeenCalledWith(200)

      vi.useRealTimers()
    })

    it('should return healthy status even with empty request', async () => {
      const emptyRequest = {}

      await fileUploadCallbackController.healthHandler(emptyRequest, mockH)
      expect(mockH.response).toHaveBeenCalledWith({
        status: 'healthy',
        timestamp: expect.any(String),
        service: 'file-upload-callback'
      })
      expect(mockH.code).toHaveBeenCalledWith(200)
    })
  })

  describe('metricsHandler', () => {
    it('should return upload service metrics successfully', async () => {
      const mockMetrics = {
        uploads: {
          total: 150,
          successful: 145,
          failed: 5
        },
        processing: {
          averageTime: 250,
          lastProcessed: '2023-12-01T09:30:00.000Z'
        }
      }
      uploadService.getHealthMetrics.mockReturnValue(mockMetrics)

      await fileUploadCallbackController.metricsHandler(mockRequest, mockH)
      expect(uploadService.getHealthMetrics).toHaveBeenCalled()
      expect(mockH.response).toHaveBeenCalledWith(mockMetrics)
      expect(mockH.code).toHaveBeenCalledWith(200)
    })

    it('should include Azure handler metrics when Azure storage is enabled', async () => {
      config.get.mockImplementation((key) => {
        if (key === 'azureStorage.enabled') return true
        return null
      })

      const mockMetrics = {
        uploads: { total: 100 },
        processing: { averageTime: 200 }
      }
      const mockAzureMetrics = {
        azureUploads: 95,
        storageHealth: 'healthy',
        lastSync: '2023-12-01T09:45:00.000Z'
      }

      uploadService.getHealthMetrics.mockReturnValue(mockMetrics)
      azureUploadHandler.getMetrics.mockReturnValue(mockAzureMetrics)

      await fileUploadCallbackController.metricsHandler(mockRequest, mockH)
      expect(azureUploadHandler.getMetrics).toHaveBeenCalled()
      expect(mockH.response).toHaveBeenCalledWith({
        ...mockMetrics,
        azureHandler: mockAzureMetrics
      })
    })

    it('should handle Azure metrics error gracefully', async () => {
      config.get.mockImplementation((key) => {
        if (key === 'azureStorage.enabled') return true
        return null
      })

      const mockMetrics = { uploads: { total: 100 } }
      uploadService.getHealthMetrics.mockReturnValue(mockMetrics)
      azureUploadHandler.getMetrics.mockImplementation(() => {
        throw new Error('Azure metrics unavailable')
      })

      await fileUploadCallbackController.metricsHandler(mockRequest, mockH)
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to get Azure handler metrics',
        {
          error: 'Azure metrics unavailable'
        }
      )
      expect(mockH.response).toHaveBeenCalledWith({
        ...mockMetrics,
        azureHandler: { error: 'Failed to retrieve metrics' }
      })
    })

    it('should return Boom.internal when upload service metrics fail', async () => {
      uploadService.getHealthMetrics.mockImplementation(() => {
        throw new Error('Metrics service down')
      })

      const result = await fileUploadCallbackController.metricsHandler(
        mockRequest,
        mockH
      )
      expect(result).toEqual(Boom.internal('Failed to get metrics'))
      expect(logger.error).toHaveBeenCalledWith('Failed to get metrics', {
        error: 'Metrics service down'
      })
    })
  })

  describe('statusHandler', () => {
    it('should return upload status for valid uploadId', async () => {
      const mockUploadId = 'upload-789'
      mockRequest.params = { uploadId: mockUploadId }

      const mockStatus = {
        uploadId: mockUploadId,
        status: 'completed',
        uploadedAt: '2023-12-01T08:00:00.000Z',
        fileSize: 1024000,
        fileName: 'document.pdf'
      }
      uploadService.getUploadStatus.mockResolvedValue(mockStatus)

      await fileUploadCallbackController.statusHandler(mockRequest, mockH)
      expect(uploadService.getUploadStatus).toHaveBeenCalledWith(mockUploadId)
      expect(logger.info).toHaveBeenCalledWith('Status request for upload', {
        uploadId: mockUploadId
      })
      expect(mockH.response).toHaveBeenCalledWith(mockStatus)
      expect(mockH.code).toHaveBeenCalledWith(200)
    })

    it('should return Boom.notFound when upload status is not found', async () => {
      const mockUploadId = 'nonexistent-upload'
      mockRequest.params = { uploadId: mockUploadId }

      uploadService.getUploadStatus.mockRejectedValue(
        new Error('Upload not found in database')
      )

      const result = await fileUploadCallbackController.statusHandler(
        mockRequest,
        mockH
      )
      expect(result).toEqual(
        Boom.notFound('Upload not found or status unavailable')
      )
      expect(logger.error).toHaveBeenCalledWith('Failed to get upload status', {
        error: 'Upload not found in database',
        uploadId: mockUploadId
      })
    })

    it('should handle database connection errors', async () => {
      const mockUploadId = 'upload-with-db-error'
      mockRequest.params = { uploadId: mockUploadId }

      uploadService.getUploadStatus.mockRejectedValue(
        new Error('Database connection timeout')
      )

      const result = await fileUploadCallbackController.statusHandler(
        mockRequest,
        mockH
      )
      expect(result).toEqual(
        Boom.notFound('Upload not found or status unavailable')
      )
      expect(logger.error).toHaveBeenCalledWith('Failed to get upload status', {
        error: 'Database connection timeout',
        uploadId: mockUploadId
      })
    })

    it('should handle missing uploadId parameter', async () => {
      mockRequest.params = {}

      await fileUploadCallbackController.statusHandler(mockRequest, mockH)
      expect(uploadService.getUploadStatus).toHaveBeenCalledWith(undefined)
      expect(logger.info).toHaveBeenCalledWith('Status request for upload', {
        uploadId: undefined
      })
    })
  })

  describe('configuration', () => {
    it('should respect Azure storage disabled configuration', async () => {
      config.get.mockImplementation((key) => {
        switch (key) {
          case 'azureStorage.enabled':
            return false
          default:
            return null
        }
      })

      uploadService.processUploadCallback.mockResolvedValue({ success: true })
      uploadSessionManager.getFormData.mockReturnValue(null)

      await fileUploadCallbackController.handler(mockRequest, mockH)
      expect(azureUploadHandler.processUploadCallback).not.toHaveBeenCalled()
      expect(uploadSessionManager.getFormData).toHaveBeenCalledWith(
        'test-upload-123'
      )
      expect(mockH.code).toHaveBeenCalledWith(200)
    })

    it('should handle config.get errors gracefully', async () => {
      config.get.mockImplementation(() => {
        throw new Error('Configuration service unavailable')
      })
      uploadService.processUploadCallback.mockResolvedValue({ success: true })
      uploadSessionManager.getFormData.mockReturnValue(null)

      await fileUploadCallbackController.handler(mockRequest, mockH)
      expect(mockH.code).toHaveBeenCalledWith(200)
      expect(azureUploadHandler.processUploadCallback).not.toHaveBeenCalled()
    })
  })

  describe('logging', () => {
    it('should log all important events during successful processing', async () => {
      uploadService.processUploadCallback.mockResolvedValue({ success: true })

      await fileUploadCallbackController.handler(mockRequest, mockH)
      expect(logger.info).toHaveBeenCalledWith(
        'Received file upload callback',
        {
          uploadId: 'test-upload-123',
          status: 'completed',
          retrievalKey: 'test-key-456'
        }
      )
      expect(logger.info).toHaveBeenCalledWith(
        'Callback processed successfully',
        {
          uploadId: 'test-upload-123',
          status: 'completed',
          azureEnabled: false,
          backgroundProcessing: false
        }
      )
    })

    it('should log debug information when Azure processing is enabled', async () => {
      config.get.mockImplementation((key) => {
        switch (key) {
          case 'azureStorage.enabled':
            return true
          case 'azureStorage.enableBackgroundProcessing':
            return false
          default:
            return null
        }
      })

      uploadService.processUploadCallback.mockResolvedValue({ success: true })
      uploadSessionManager.getFormData.mockReturnValue(null)
      azureUploadHandler.processUploadCallback.mockResolvedValue({
        success: true
      })

      await fileUploadCallbackController.handler(mockRequest, mockH)
      expect(logger.debug).toHaveBeenCalledWith(
        'Processing callback with Azure handler',
        {
          uploadId: 'test-upload-123',
          status: 'completed'
        }
      )
    })
  })
})
