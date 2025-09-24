import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./cdp-uploader-client.js', () => ({
  default: {
    validateFile: vi.fn(),
    initiateUpload: vi.fn(),
    deleteUpload: vi.fn(),
    getUploadStatus: vi.fn()
  }
}))

vi.mock('./upload-session-manager.js', () => ({
  default: {
    createSession: vi.fn(),
    getSession: vi.fn(),
    updateSession: vi.fn(),
    completeSession: vi.fn(),
    failSession: vi.fn(),
    storeFormData: vi.fn(),
    getFormData: vi.fn(),
    getHealthMetrics: vi.fn()
  }
}))

vi.mock('./upload-security.js', () => ({
  validateFileUpload: vi.fn(),
  checkRateLimit: vi.fn(),
  validateFileContent: vi.fn(),
  getSecurityMetrics: vi.fn(),
  default: {
    validateFileUpload: vi.fn(),
    checkRateLimit: vi.fn(),
    validateFileContent: vi.fn(),
    getSecurityMetrics: vi.fn()
  }
}))

vi.mock('../common/helpers/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn()
  }
}))

let mockIsProduction = false

vi.mock('../../config/config.js', () => ({
  config: {
    get: vi.fn((key) => {
      if (key === 'isProduction') return mockIsProduction
      if (key === 'isDevelopment') return !mockIsProduction
      if (key === 'cdpUploader.callbackAuthToken') return 'test-api-key'
      return false
    })
  }
}))

describe('upload-service', () => {
  let cdpUploaderClient
  let uploadSessionManager
  let uploadSecurity
  let logger
  let uploadService // eslint-disable-line no-unused-vars

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    // Reset production flag
    mockIsProduction = false

    // Re-import modules to get fresh instances
    const cdpModule = await import('./cdp-uploader-client.js')
    cdpUploaderClient = cdpModule.default

    const sessionModule = await import('./upload-session-manager.js')
    uploadSessionManager = sessionModule.default

    const securityModule = await import('./upload-security.js')
    uploadSecurity = {
      validateFileUpload: securityModule.validateFileUpload,
      checkRateLimit: securityModule.checkRateLimit,
      validateFileContent: securityModule.validateFileContent,
      getSecurityMetrics: securityModule.getSecurityMetrics
    }

    const loggerModule = await import('../common/helpers/logging/logger.js')
    logger = loggerModule.logger
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('uploadFile', () => {
    const mockFile = {
      originalname: 'test-file.pdf',
      size: 1024000,
      mimetype: 'application/pdf',
      buffer: Buffer.from('mock-file-content')
    }

    const mockOptions = {
      allowedMimeTypes: ['application/pdf'],
      metadata: { userId: 'user-123' },
      formData: { field1: 'value1' },
      clientIp: '192.168.1.1'
    }

    describe('security validation', () => {
      beforeEach(async () => {
        mockIsProduction = false
        const module = await import('./upload-service.js')
        uploadService = module.default

        uploadSecurity.validateFileUpload.mockReturnValue({
          valid: true,
          errors: []
        })
        uploadSecurity.checkRateLimit.mockReturnValue({
          allowed: true,
          remaining: 50,
          resetTime: Date.now() + 3600000
        })
      })

      it('validates upload request with security service', async () => {
        const { uploadFile } = await import('./upload-service.js')
        await uploadFile(mockFile, 'test-form', mockOptions)

        expect(uploadSecurity.validateFileUpload).toHaveBeenCalledWith(
          mockFile,
          { allowedMimeTypes: ['application/pdf'] }
        )
      })

      it('throws error when security validation fails', async () => {
        uploadSecurity.validateFileUpload.mockReturnValue({
          valid: false,
          errors: ['Invalid file type', 'File too large']
        })

        const { uploadFile } = await import('./upload-service.js')
        await expect(
          uploadFile(mockFile, 'test-form', mockOptions)
        ).rejects.toThrow(
          'Security validation failed: Invalid file type, File too large'
        )
      })

      it('checks rate limits with client IP and file size', async () => {
        const { uploadFile } = await import('./upload-service.js')
        await uploadFile(mockFile, 'test-form', mockOptions)

        expect(uploadSecurity.checkRateLimit).toHaveBeenCalledWith(
          '192.168.1.1',
          1024000
        )
      })

      it('throws rate limit error with retry information', async () => {
        uploadSecurity.checkRateLimit.mockReturnValue({
          allowed: false,
          reason: 'Too many requests',
          retryAfter: 60000
        })

        const { uploadFile } = await import('./upload-service.js')

        try {
          await uploadFile(mockFile, 'test-form', mockOptions)
          expect.fail('Should have thrown rate limit error')
        } catch (error) {
          expect(error.message).toBe(
            'Upload failed: Rate limit exceeded: Too many requests'
          )
          expect(error.retryAfter).toBe(60000)
        }
      })

      it('uses default clientIp when not provided', async () => {
        const optionsWithoutIp = { ...mockOptions }
        delete optionsWithoutIp.clientIp

        const { uploadFile } = await import('./upload-service.js')
        await uploadFile(mockFile, 'test-form', optionsWithoutIp)

        expect(uploadSecurity.checkRateLimit).toHaveBeenCalledWith(
          'unknown',
          1024000
        )
      })
    })

    describe('non-production mode', () => {
      beforeEach(async () => {
        mockIsProduction = false

        // Setup default mocks
        uploadSecurity.validateFileUpload.mockReturnValue({
          valid: true,
          errors: []
        })
        uploadSecurity.checkRateLimit.mockReturnValue({
          allowed: true,
          remaining: 50,
          resetTime: Date.now() + 3600000
        })

        uploadSessionManager.createSession.mockReturnValue({
          id: 'mock-session-id',
          status: 'created'
        })
      })

      it('handles mock upload in non-production mode', async () => {
        const { uploadFile } = await import('./upload-service.js')
        const result = await uploadFile(mockFile, 'test-form', mockOptions)

        expect(result).toMatchObject({
          id: expect.stringMatching(/^mock-\d+$/),
          retrievalKey: expect.stringMatching(/^mock-key-\d+$/),
          originalName: 'test-file.pdf',
          size: 1024000,
          mimetype: 'application/pdf',
          status: 'completed',
          url: '/uploads/test-file.pdf',
          formId: 'test-form'
        })

        expect(uploadSessionManager.createSession).toHaveBeenCalled()
      })

      it('completes mock session asynchronously', async () => {
        vi.useFakeTimers()
        const completeSpy = vi.spyOn(uploadSessionManager, 'completeSession')

        const { uploadFile } = await import('./upload-service.js')
        await uploadFile(mockFile, 'test-form', mockOptions)

        vi.advanceTimersByTime(100)

        expect(completeSpy).toHaveBeenCalledWith(
          expect.stringMatching(/^mock-\d+$/),
          expect.objectContaining({
            url: '/uploads/test-file.pdf'
          })
        )

        vi.useRealTimers()
      })
    })

    describe('production mode', () => {
      beforeEach(async () => {
        mockIsProduction = true
        vi.resetModules()

        // Re-import mocked modules after setting production mode
        const cdpModule = await import('./cdp-uploader-client.js')
        cdpUploaderClient = cdpModule.default

        const sessionModule = await import('./upload-session-manager.js')
        uploadSessionManager = sessionModule.default

        const securityModule = await import('./upload-security.js')
        uploadSecurity = {
          validateFileUpload: securityModule.validateFileUpload,
          checkRateLimit: securityModule.checkRateLimit,
          validateFileContent: securityModule.validateFileContent,
          getSecurityMetrics: securityModule.getSecurityMetrics
        }

        // Mock security to pass validation
        uploadSecurity.validateFileUpload.mockReturnValue({
          valid: true,
          errors: []
        })
        uploadSecurity.checkRateLimit.mockReturnValue({
          allowed: true,
          remaining: 50,
          resetTime: Date.now() + 3600000
        })

        // Mock CDP client validation
        cdpUploaderClient.validateFile.mockReturnValue({
          valid: true,
          errors: []
        })

        // Mock CDP upload initiation
        cdpUploaderClient.initiateUpload.mockResolvedValue({
          uploadId: 'cdp-upload-123',
          uploadUrl: 'https://example.com/upload',
          metadata: { source: 'cdp-uploader' }
        })

        // Mock session creation
        uploadSessionManager.createSession.mockReturnValue({
          id: 'session-123',
          status: 'created'
        })

        uploadSessionManager.storeFormData.mockReturnValue()
      })

      it('validates file with CDP client', async () => {
        const { uploadFile } = await import('./upload-service.js')
        await uploadFile(mockFile, 'test-form', mockOptions)

        expect(cdpUploaderClient.validateFile).toHaveBeenCalledWith(mockFile, [
          'application/pdf'
        ])
      })

      it('throws error when CDP validation fails', async () => {
        cdpUploaderClient.validateFile.mockReturnValue({
          valid: false,
          errors: ['Unsupported file type']
        })

        const { uploadFile } = await import('./upload-service.js')
        await expect(
          uploadFile(mockFile, 'test-form', mockOptions)
        ).rejects.toThrow('File validation failed: Unsupported file type')
      })

      it('generates unique retrieval key', async () => {
        const { uploadFile } = await import('./upload-service.js')
        const result = await uploadFile(mockFile, 'test-form', mockOptions)

        expect(result.retrievalKey).toMatch(/^test-form-\d+-[a-z0-9]+$/)
      })

      it('initiates upload with CDP client', async () => {
        const { uploadFile } = await import('./upload-service.js')
        await uploadFile(mockFile, 'test-form', mockOptions)

        expect(cdpUploaderClient.initiateUpload).toHaveBeenCalledWith({
          formPath: '/forms/test-form',
          retrievalKey: expect.stringMatching(/^test-form-\d+-[a-z0-9]+$/),
          mimeTypes: ['application/pdf'],
          metadata: expect.objectContaining({
            originalName: 'test-file.pdf',
            size: 1024000,
            mimetype: 'application/pdf',
            formId: 'test-form',
            clientIp: '192.168.1.1',
            formData: { field1: 'value1' },
            userId: 'user-123'
          })
        })
      })

      it('creates upload session with metadata', async () => {
        const { uploadFile } = await import('./upload-service.js')
        await uploadFile(mockFile, 'test-form', mockOptions)

        expect(uploadSessionManager.createSession).toHaveBeenCalledWith(
          'cdp-upload-123',
          expect.objectContaining({
            originalName: 'test-file.pdf',
            size: 1024000,
            mimetype: 'application/pdf',
            formId: 'test-form',
            clientIp: '192.168.1.1',
            formData: { field1: 'value1' },
            userId: 'user-123'
          })
        )
      })

      it('stores form data separately when provided', async () => {
        const { uploadFile } = await import('./upload-service.js')
        await uploadFile(mockFile, 'test-form', mockOptions)

        expect(uploadSessionManager.storeFormData).toHaveBeenCalledWith(
          'cdp-upload-123',
          { field1: 'value1' }
        )

        expect(logger.info).toHaveBeenCalledWith(
          'Form data stored in session for Azure JSON upload',
          expect.objectContaining({
            uploadId: 'cdp-upload-123',
            formFieldCount: 1
          })
        )
      })

      it('does not store form data when not provided', async () => {
        const optionsWithoutFormData = { ...mockOptions }
        delete optionsWithoutFormData.formData

        const { uploadFile } = await import('./upload-service.js')
        await uploadFile(mockFile, 'test-form', optionsWithoutFormData)

        expect(uploadSessionManager.storeFormData).not.toHaveBeenCalled()
      })

      it('returns complete upload response', async () => {
        const { uploadFile } = await import('./upload-service.js')
        const result = await uploadFile(mockFile, 'test-form', mockOptions)

        expect(result).toMatchObject({
          id: 'cdp-upload-123',
          retrievalKey: expect.stringMatching(/^test-form-\d+-[a-z0-9]+$/),
          originalName: 'test-file.pdf',
          size: 1024000,
          mimetype: 'application/pdf',
          status: 'initiated',
          uploadUrl: 'https://example.com/upload',
          formId: 'test-form',
          metadata: { source: 'cdp-uploader' },
          rateLimitInfo: {
            remaining: 50,
            resetTime: expect.any(Number)
          }
        })
      })

      it('logs successful upload initiation', async () => {
        const { uploadFile } = await import('./upload-service.js')
        await uploadFile(mockFile, 'test-form', mockOptions)

        expect(logger.info).toHaveBeenCalledWith(
          'File upload initiated successfully',
          expect.objectContaining({
            uploadId: 'cdp-upload-123',
            retrievalKey: expect.stringMatching(/^test-form-\d+-[a-z0-9]+$/),
            formId: 'test-form',
            originalName: 'test-file.pdf'
          })
        )
      })

      it('handles CDP client errors', async () => {
        cdpUploaderClient.initiateUpload.mockRejectedValue(
          new Error('CDP service unavailable')
        )

        const { uploadFile } = await import('./upload-service.js')
        await expect(
          uploadFile(mockFile, 'test-form', mockOptions)
        ).rejects.toThrow('Upload failed: CDP service unavailable')
      })
    })

    describe('edge cases', () => {
      beforeEach(async () => {
        mockIsProduction = false

        uploadSecurity.validateFileUpload.mockReturnValue({
          valid: true,
          errors: []
        })
        uploadSecurity.checkRateLimit.mockReturnValue({
          allowed: true,
          remaining: 50,
          resetTime: Date.now() + 3600000
        })
      })

      it('should handle empty options object', async () => {
        const { uploadFile } = await import('./upload-service.js')
        const result = await uploadFile(mockFile, 'test-form', {})

        expect(result).toBeDefined()
        expect(result.id).toMatch(/^mock-\d+$/)
      })

      it('should handle undefined options', async () => {
        const { uploadFile } = await import('./upload-service.js')
        const result = await uploadFile(mockFile, 'test-form')

        expect(result).toBeDefined()
        expect(result.id).toMatch(/^mock-\d+$/)
      })

      it('should handle very large file sizes', async () => {
        const largeFile = {
          ...mockFile,
          size: 5 * 1024 * 1024 * 1024 // 5GB
        }

        const { uploadFile } = await import('./upload-service.js')
        const result = await uploadFile(largeFile, 'test-form', mockOptions)

        expect(result.size).toBe(5 * 1024 * 1024 * 1024)
      })
    })
  })

  describe('deleteFile', () => {
    describe('non-production mode', () => {
      beforeEach(async () => {
        mockIsProduction = false
      })

      it('should handle mock deletion in non-production mode', async () => {
        const { deleteFile } = await import('./upload-service.js')
        const result = await deleteFile('upload-123')

        expect(result).toEqual({
          success: true,
          uploadId: 'upload-123'
        })

        expect(logger.info).toHaveBeenCalledWith('Mock file deletion', {
          uploadId: 'upload-123'
        })
      })
    })

    describe('production mode', () => {
      beforeEach(async () => {
        mockIsProduction = true
        vi.resetModules()

        const cdpModule = await import('./cdp-uploader-client.js')
        cdpUploaderClient = cdpModule.default

        cdpUploaderClient.deleteUpload.mockResolvedValue({
          success: true,
          deletedAt: '2024-01-01T12:00:00Z'
        })
      })

      it('should delete file through CDP client', async () => {
        const { deleteFile } = await import('./upload-service.js')
        await deleteFile('upload-123')

        expect(cdpUploaderClient.deleteUpload).toHaveBeenCalledWith(
          'upload-123'
        )
      })

      it('should log successful deletion', async () => {
        const { deleteFile } = await import('./upload-service.js')
        await deleteFile('upload-123')

        expect(logger.info).toHaveBeenCalledWith('File deleted successfully', {
          uploadId: 'upload-123'
        })
      })

      it('should handle CDP client deletion errors', async () => {
        cdpUploaderClient.deleteUpload.mockRejectedValue(
          new Error('CDP service error')
        )

        const { deleteFile } = await import('./upload-service.js')
        await expect(deleteFile('upload-123')).rejects.toThrow(
          'Deletion failed: CDP service error'
        )
      })

      it('should return ISO timestamp for deletion', async () => {
        const { deleteFile } = await import('./upload-service.js')
        const result = await deleteFile('upload-123')

        expect(result).toMatchObject({
          success: true,
          uploadId: 'upload-123',
          deletedAt: expect.stringMatching(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
          )
        })
      })
    })
  })

  describe('getUploadStatus', () => {
    describe('non-production mode', () => {
      beforeEach(async () => {
        mockIsProduction = false

        uploadSessionManager.getSession.mockReturnValue({
          status: 'active',
          progress: 50,
          createdAt: Date.now() - 60000,
          lastActivity: Date.now(),
          attempts: 1
        })
      })

      it('should return mock status with session info', async () => {
        const { getUploadStatus } = await import('./upload-service.js')
        const result = await getUploadStatus('upload-123')

        expect(result).toMatchObject({
          uploadId: 'upload-123',
          status: 'completed',
          progress: 100,
          sessionInfo: expect.objectContaining({
            sessionStatus: 'active',
            progress: 50
          })
        })
      })

      it('should return mock status without session info when session not found', async () => {
        uploadSessionManager.getSession.mockReturnValue(null)

        const { getUploadStatus } = await import('./upload-service.js')
        const result = await getUploadStatus('upload-123')

        expect(result).toMatchObject({
          uploadId: 'upload-123',
          status: 'completed',
          progress: 100,
          sessionInfo: null
        })
      })
    })

    describe('production mode', () => {
      beforeEach(async () => {
        mockIsProduction = true
        vi.resetModules()

        const cdpModule = await import('./cdp-uploader-client.js')
        cdpUploaderClient = cdpModule.default

        const sessionModule = await import('./upload-session-manager.js')
        uploadSessionManager = sessionModule.default

        uploadSessionManager.getSession.mockReturnValue({
          status: 'active',
          progress: 75
        })

        cdpUploaderClient.getUploadStatus.mockResolvedValue({
          uploadId: 'upload-123',
          status: 'uploading',
          progress: 80
        })
      })

      it('should get status from CDP client with session info', async () => {
        const { getUploadStatus } = await import('./upload-service.js')
        const result = await getUploadStatus('upload-123')

        expect(cdpUploaderClient.getUploadStatus).toHaveBeenCalledWith(
          'upload-123'
        )
        expect(result).toMatchObject({
          uploadId: 'upload-123',
          status: 'uploading',
          progress: 80,
          sessionInfo: expect.objectContaining({
            sessionStatus: 'active',
            progress: 75
          })
        })
      })

      it('should handle CDP client status errors', async () => {
        cdpUploaderClient.getUploadStatus.mockRejectedValue(
          new Error('CDP service unavailable')
        )

        const { getUploadStatus } = await import('./upload-service.js')
        await expect(getUploadStatus('upload-123')).rejects.toThrow(
          'Status check failed: CDP service unavailable'
        )
      })
    })
  })

  describe('processUploadCallback', () => {
    const mockCallbackData = {
      uploadId: 'upload-123',
      status: 'completed',
      retrievalKey: 'key-123',
      metadata: { formId: 'test-form' },
      files: [{ filename: 'test.pdf', size: 1024, mimetype: 'application/pdf' }]
    }

    beforeEach(async () => {
      mockIsProduction = false

      // Setup security mocks for callback processing
      vi.spyOn(uploadSessionManager, 'getSession').mockReturnValue({
        status: 'active',
        createdAt: Date.now()
      })
      vi.spyOn(uploadSessionManager, 'completeSession').mockReturnValue()
      vi.spyOn(uploadSessionManager, 'failSession').mockReturnValue()
      vi.spyOn(uploadSessionManager, 'updateSession').mockReturnValue()
    })

    it('should validate callback request security', async () => {
      const mockRequest = {
        headers: {
          'x-callback-token': 'secret',
          'x-api-key': 'test-api-key'
        }
      }

      const { processUploadCallback } = await import('./upload-service.js')
      const result = await processUploadCallback(mockCallbackData, mockRequest)

      expect(result.success).toBe(true)
    })

    it('should process completed upload callbacks', async () => {
      const { processUploadCallback } = await import('./upload-service.js')
      const result = await processUploadCallback(mockCallbackData)

      expect(result).toMatchObject({
        success: true,
        uploadId: 'upload-123',
        retrievalKey: 'key-123',
        status: 'completed',
        files: expect.arrayContaining([
          expect.objectContaining({ filename: 'test.pdf' })
        ])
      })

      expect(uploadSessionManager.completeSession).toHaveBeenCalled()
    })

    it('should process failed upload callbacks', async () => {
      const failedCallback = {
        ...mockCallbackData,
        status: 'failed',
        error: 'Upload failed due to network error'
      }

      const { processUploadCallback } = await import('./upload-service.js')
      const result = await processUploadCallback(failedCallback)

      expect(result).toMatchObject({
        success: false,
        uploadId: 'upload-123',
        status: 'failed',
        error: 'Upload failed due to network error'
      })

      expect(uploadSessionManager.failSession).toHaveBeenCalled()
    })

    it('should process cancelled upload callbacks', async () => {
      const cancelledCallback = {
        ...mockCallbackData,
        status: 'cancelled'
      }

      const { processUploadCallback } = await import('./upload-service.js')
      const result = await processUploadCallback(cancelledCallback)

      expect(result).toMatchObject({
        success: false,
        uploadId: 'upload-123',
        status: 'cancelled'
      })

      expect(uploadSessionManager.updateSession).toHaveBeenCalledWith(
        'upload-123',
        { status: 'cancelled' }
      )
    })

    it('should handle unknown status in callbacks', async () => {
      const unknownCallback = {
        ...mockCallbackData,
        status: 'unknown'
      }

      const { processUploadCallback } = await import('./upload-service.js')
      const result = await processUploadCallback(unknownCallback)

      expect(result).toMatchObject({
        success: false,
        error: 'Unknown status'
      })
    })

    it('should reject invalid callback requests', async () => {
      const mockRequest = { headers: {} } // Missing required headers

      const { processUploadCallback } = await import('./upload-service.js')
      await expect(
        processUploadCallback(mockCallbackData, mockRequest)
      ).rejects.toThrow('Invalid callback request')
    })
  })

  describe('getHealthMetrics', () => {
    beforeEach(async () => {
      mockIsProduction = false

      uploadSessionManager.getHealthMetrics.mockReturnValue({
        totalSessions: 10,
        activeSessions: 3
      })

      uploadSecurity.getSecurityMetrics.mockReturnValue({
        totalUploads: 100,
        rejectedUploads: 5
      })
    })

    it('should return comprehensive health metrics', async () => {
      const { getHealthMetrics } = await import('./upload-service.js')
      const metrics = getHealthMetrics()

      expect(metrics).toMatchObject({
        sessions: {
          totalSessions: 10,
          activeSessions: 3
        },
        security: {
          totalUploads: 100,
          rejectedUploads: 5
        },
        service: expect.objectContaining({
          isProduction: false,
          uptime: expect.any(Number),
          memoryUsage: expect.any(Object)
        })
      })
    })

    it('should include current production status', async () => {
      mockIsProduction = true
      vi.resetModules()

      const { getHealthMetrics } = await import('./upload-service.js')
      const metrics = getHealthMetrics()

      expect(metrics.service.isProduction).toBe(true)
    })
  })

  describe('integration scenarios', () => {
    beforeEach(async () => {
      mockIsProduction = false

      uploadSecurity.validateFileUpload.mockReturnValue({
        valid: true,
        errors: []
      })
      uploadSecurity.checkRateLimit.mockReturnValue({
        allowed: true,
        remaining: 50,
        resetTime: Date.now() + 3600000
      })

      uploadSessionManager.createSession.mockReturnValue({
        id: 'session-123',
        status: 'created'
      })
    })

    it('should handle complete upload workflow', async () => {
      const file = {
        originalname: 'document.pdf',
        size: 2048000,
        mimetype: 'application/pdf'
      }

      const { uploadFile } = await import('./upload-service.js')
      const result = await uploadFile(file, 'application-form', {
        allowedMimeTypes: ['application/pdf'],
        metadata: { applicationId: 'app-456' },
        clientIp: '10.0.0.1'
      })

      expect(result).toBeDefined()
      expect(result.id).toMatch(/^mock-\d+$/)
      expect(uploadSecurity.validateFileUpload).toHaveBeenCalled()
      expect(uploadSecurity.checkRateLimit).toHaveBeenCalledWith(
        '10.0.0.1',
        2048000
      )
    })

    it('should handle rate limiting scenario', async () => {
      uploadSecurity.checkRateLimit.mockReturnValue({
        allowed: false,
        reason: 'Too many requests from IP',
        retryAfter: 30000
      })

      const file = {
        originalname: 'test.pdf',
        size: 1024,
        mimetype: 'application/pdf'
      }

      const { uploadFile } = await import('./upload-service.js')
      const error = await uploadFile(file, 'test-form', {
        clientIp: '192.168.1.1'
      }).catch((err) => err)

      expect(error.message).toContain('Upload failed: Rate limit exceeded')
      expect(error.retryAfter).toBe(30000)
    })

    it('should handle security validation failure', async () => {
      uploadSecurity.validateFileUpload.mockReturnValue({
        valid: false,
        errors: ['Suspicious file content', 'Invalid extension']
      })

      const file = {
        originalname: 'malicious.exe',
        size: 1024,
        mimetype: 'application/octet-stream'
      }

      const { uploadFile } = await import('./upload-service.js')
      await expect(uploadFile(file, 'test-form')).rejects.toThrow(
        'Security validation failed: Suspicious file content, Invalid extension'
      )
    })
  })

  describe('private method testing', () => {
    it('should export _generateRetrievalKey for testing', async () => {
      const { default: uploadService } = await import('./upload-service.js')
      expect(uploadService._generateRetrievalKey).toBeDefined()
      expect(typeof uploadService._generateRetrievalKey).toBe('function')
    })

    it('should generate unique retrieval keys', async () => {
      const { default: uploadService } = await import('./upload-service.js')
      const key1 = uploadService._generateRetrievalKey('form1', 'file.pdf')
      const key2 = uploadService._generateRetrievalKey('form1', 'file.pdf')

      expect(key1).toMatch(/^form1-\d+-[a-z0-9]+$/)
      expect(key2).toMatch(/^form1-\d+-[a-z0-9]+$/)
      expect(key1).not.toBe(key2)
    })
  })
})
