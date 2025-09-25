import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  initiateUpload,
  getUploadStatus,
  deleteUpload,
  validateFile,
  getHealthInfo,
  resetInitializedState
} from './cdp-uploader-client.js'

import { logger } from '../common/helpers/logging/logger.js'
import { config } from '../../config/config.js'

// Mock dependencies
vi.mock('../common/helpers/logging/logger.js')
vi.mock('../../config/config.js')

// Mock global fetch
global.fetch = vi.fn()

describe('CDP Uploader Client', () => {
  const mockConfig = {
    cdpUploader: {
      baseUrl: 'https://test-cdp-uploader.gov.uk',
      submissionUrl: 'https://test-submission.gov.uk',
      bucketName: 'test-bucket',
      stagingPrefix: 'staging',
      maxFileSize: 10485760,
      timeout: 30000,
      retryAttempts: 3
    }
  }

  class MockResponse {
    constructor(data, { status = 200, statusText = 'OK', ok = true } = {}) {
      this.data = data
      this.status = status
      this.statusText = statusText
      this.ok = ok
    }

    async json() {
      return this.data
    }

    async text() {
      return typeof this.data === 'string'
        ? this.data
        : JSON.stringify(this.data)
    }
  }

  beforeEach(() => {
    // Reset all mocks before each test
    vi.resetAllMocks()
    vi.clearAllMocks()

    // Mock config.get
    config.get = vi.fn((key) => {
      if (key === 'cdpUploader') {
        return mockConfig.cdpUploader
      }
      return null
    })

    // Mock logger methods
    logger.info = vi.fn()
    logger.debug = vi.fn()
    logger.warn = vi.fn()
    logger.error = vi.fn()

    // Reset the module's initialization state
    resetInitializedState()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('initiateUpload', () => {
    it('should successfully initiate upload with all parameters', async () => {
      const mockResponseData = {
        uploadId: 'upload-123-456',
        uploadUrl: 'https://azure.blob.core.windows.net/test-bucket/upload-url',
        metadata: { formPath: '/forms/test' },
        retrievalKey: 'test-key',
        expiresAt: Date.now() + 3600000
      }

      global.fetch.mockResolvedValueOnce(new MockResponse(mockResponseData))

      const uploadOptions = {
        formPath: '/forms/test-form',
        retrievalKey: 'test-retrieval-key',
        mimeTypes: ['application/pdf', 'image/jpeg'],
        metadata: { submissionId: 'sub-123', userId: 'user-456' },
        callbackUrl: 'https://callback.test.com/upload',
        maxFileSize: 5242880 // 5MB override
      }

      const result = await initiateUpload(uploadOptions)

      expect(result).toEqual(mockResponseData)
      expect(global.fetch).toHaveBeenCalledWith(
        'https://test-cdp-uploader.gov.uk/initiate',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'apha-sdo-frontend/1.0.0'
          },
          timeout: 30000,
          body: JSON.stringify({
            formPath: '/forms/test-form',
            retrievalKey: 'test-retrieval-key',
            bucketName: 'test-bucket',
            stagingPrefix: 'staging',
            allowedMimeTypes: ['application/pdf', 'image/jpeg'],
            maxFileSize: 5242880,
            metadata: { submissionId: 'sub-123', userId: 'user-456' },
            callbackUrl: 'https://callback.test.com/upload'
          })
        })
      )

      expect(logger.info).toHaveBeenCalledWith(
        'Initiating CDP upload session',
        expect.objectContaining({
          formPath: '/forms/test-form',
          retrievalKey: 'test-retrieval-key',
          mimeTypesCount: 2,
          maxFileSize: 5242880
        })
      )
    })

    it('should use default callback URL when not provided', async () => {
      const mockResponseData = {
        uploadId: 'upload-123',
        uploadUrl: 'https://test.com'
      }
      global.fetch.mockResolvedValueOnce(new MockResponse(mockResponseData))

      await initiateUpload({
        formPath: '/forms/test',
        retrievalKey: 'test-key'
      })

      const callBody = JSON.parse(global.fetch.mock.calls[0][1].body)
      expect(callBody.callbackUrl).toBe(
        'https://test-submission.gov.uk/file-upload-callback'
      )
    })

    it('should use default values for optional parameters', async () => {
      const mockResponseData = {
        uploadId: 'upload-123',
        uploadUrl: 'https://test.com'
      }
      global.fetch.mockResolvedValueOnce(new MockResponse(mockResponseData))

      await initiateUpload({
        formPath: '/forms/test',
        retrievalKey: 'test-key'
      })

      const callBody = JSON.parse(global.fetch.mock.calls[0][1].body)
      expect(callBody.allowedMimeTypes).toEqual([])
      expect(callBody.metadata).toEqual({})
      expect(callBody.maxFileSize).toBe(10485760)
    })

    it('should throw error when formPath is missing', async () => {
      await expect(
        initiateUpload({
          retrievalKey: 'test-key'
        })
      ).rejects.toThrow('formPath is required for upload initiation')
    })

    it('should throw error when retrievalKey is missing', async () => {
      await expect(
        initiateUpload({
          formPath: '/forms/test'
        })
      ).rejects.toThrow('retrievalKey is required for upload initiation')
    })

    it('should handle API errors gracefully', async () => {
      const errorResponse = new MockResponse('Server Error', {
        status: 500,
        statusText: 'Internal Server Error',
        ok: false
      })

      global.fetch.mockReset()
      global.fetch.mockResolvedValue(errorResponse)

      await expect(
        initiateUpload({
          formPath: '/forms/test',
          retrievalKey: 'test-key'
        })
      ).rejects.toThrow(
        'Upload initiation failed: CDP API error: 500 Internal Server Error - Server Error'
      )

      expect(logger.error).toHaveBeenCalledWith(
        'CDP upload initiation failed',
        expect.objectContaining({
          formPath: '/forms/test',
          retrievalKey: 'test-key'
        })
      )
    })
  })

  describe('getUploadStatus', () => {
    it('should successfully get upload status', async () => {
      const mockStatusData = {
        uploadId: 'upload-123',
        status: 'completed',
        progress: 100,
        files: [{ name: 'test.pdf', size: 1024 }],
        lastActivity: Date.now()
      }

      global.fetch.mockResolvedValueOnce(new MockResponse(mockStatusData))

      const result = await getUploadStatus('upload-123')

      expect(result).toEqual(mockStatusData)
      expect(global.fetch).toHaveBeenCalledWith(
        'https://test-cdp-uploader.gov.uk/status/upload-123',
        expect.objectContaining({
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'apha-sdo-frontend/1.0.0'
          },
          timeout: 30000
        })
      )

      expect(logger.debug).toHaveBeenCalledWith('Checking CDP upload status', {
        uploadId: 'upload-123'
      })
    })

    it('should throw error when uploadId is missing', async () => {
      await expect(getUploadStatus()).rejects.toThrow(
        'uploadId is required for status check'
      )
      await expect(getUploadStatus('')).rejects.toThrow(
        'uploadId is required for status check'
      )
      await expect(getUploadStatus(null)).rejects.toThrow(
        'uploadId is required for status check'
      )
    })

    it('should handle API errors for status check', async () => {
      const errorResponse = new MockResponse('Not Found', {
        status: 404,
        statusText: 'Not Found',
        ok: false
      })
      global.fetch.mockReset()
      global.fetch.mockResolvedValue(errorResponse)

      await expect(getUploadStatus('invalid-id')).rejects.toThrow(
        'Status check failed: CDP API error: 404 Not Found - Not Found'
      )

      expect(logger.error).toHaveBeenCalledWith(
        'CDP upload status check failed',
        expect.objectContaining({
          uploadId: 'invalid-id'
        })
      )
    })
  })

  describe('deleteUpload', () => {
    it('should successfully delete upload', async () => {
      const deletedAt = new Date().toISOString()
      const mockDeleteData = { deletedAt }

      global.fetch.mockResolvedValueOnce(new MockResponse(mockDeleteData))

      const result = await deleteUpload('upload-123')

      expect(result).toEqual({
        success: true,
        uploadId: 'upload-123',
        deletedAt
      })

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test-cdp-uploader.gov.uk/upload/upload-123',
        expect.objectContaining({
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'apha-sdo-frontend/1.0.0'
          },
          timeout: 30000
        })
      )

      expect(logger.info).toHaveBeenCalledWith('Deleting CDP upload session', {
        uploadId: 'upload-123'
      })
    })

    it('should use current timestamp when deletedAt not provided', async () => {
      global.fetch.mockResolvedValueOnce(new MockResponse({}))

      const result = await deleteUpload('upload-123')

      expect(result.success).toBe(true)
      expect(result.uploadId).toBe('upload-123')
      expect(result.deletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it('should throw error when uploadId is missing', async () => {
      await expect(deleteUpload()).rejects.toThrow(
        'uploadId is required for deletion'
      )
      await expect(deleteUpload('')).rejects.toThrow(
        'uploadId is required for deletion'
      )
      await expect(deleteUpload(null)).rejects.toThrow(
        'uploadId is required for deletion'
      )
    })

    it('should handle API errors for deletion', async () => {
      const errorResponse = new MockResponse('Forbidden', {
        status: 403,
        statusText: 'Forbidden',
        ok: false
      })
      global.fetch.mockReset()
      global.fetch.mockResolvedValue(errorResponse)

      await expect(deleteUpload('upload-123')).rejects.toThrow(
        'Upload deletion failed: CDP API error: 403 Forbidden - Forbidden'
      )

      expect(logger.error).toHaveBeenCalledWith(
        'CDP upload deletion failed',
        expect.objectContaining({
          uploadId: 'upload-123'
        })
      )
    })
  })

  describe('validateFile', () => {
    const validFile = {
      originalname: 'test-document.pdf',
      size: 1024000, // 1MB
      mimetype: 'application/pdf'
    }

    it('should validate a valid file successfully', () => {
      const result = validateFile(validFile, ['application/pdf'])

      expect(result).toEqual({
        valid: true,
        errors: [],
        fileInfo: {
          originalname: 'test-document.pdf',
          size: 1024000,
          mimetype: 'application/pdf',
          extension: 'pdf'
        }
      })
    })

    it('should validate file without MIME type restrictions', () => {
      const result = validateFile(validFile)

      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })

    it('should reject file with invalid MIME type', () => {
      const result = validateFile(validFile, ['image/jpeg', 'image/png'])

      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
        "File MIME type 'application/pdf' is not allowed. Allowed types: image/jpeg, image/png"
      )
    })

    it('should reject file exceeding size limit', () => {
      const largeFile = {
        ...validFile,
        size: 15728640 // 15MB (exceeds 10MB limit)
      }

      const result = validateFile(largeFile, ['application/pdf'])

      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
        'File size 15728640 exceeds maximum allowed size of 10485760 bytes'
      )
    })

    it('should reject file with missing originalname', () => {
      const fileWithoutName = {
        size: 1024,
        mimetype: 'application/pdf'
      }

      const result = validateFile(fileWithoutName)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('File must have an original filename')
    })

    it('should reject file with invalid size', () => {
      const fileWithInvalidSize = {
        originalname: 'test.pdf',
        size: 0,
        mimetype: 'application/pdf'
      }

      const result = validateFile(fileWithInvalidSize)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
        'File must have a valid size greater than 0'
      )
    })

    it('should reject file with missing mimetype', () => {
      const fileWithoutMimeType = {
        originalname: 'test.pdf',
        size: 1024
      }

      const result = validateFile(fileWithoutMimeType)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('File must have a MIME type')
    })

    it('should reject file with path traversal in filename', () => {
      const maliciousFile = {
        originalname: '../../../etc/passwd',
        size: 1024,
        mimetype: 'text/plain'
      }

      const result = validateFile(maliciousFile)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
        'Filename contains invalid characters or path traversal sequences'
      )
    })

    it('should reject file with forward slash in filename', () => {
      const fileWithSlash = {
        originalname: 'folder/test.pdf',
        size: 1024,
        mimetype: 'application/pdf'
      }

      const result = validateFile(fileWithSlash)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
        'Filename contains invalid characters or path traversal sequences'
      )
    })

    it('should reject file with backslash in filename', () => {
      const fileWithBackslash = {
        originalname: 'folder\\test.pdf',
        size: 1024,
        mimetype: 'application/pdf'
      }

      const result = validateFile(fileWithBackslash)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
        'Filename contains invalid characters or path traversal sequences'
      )
    })

    it('should handle null file input', () => {
      const result = validateFile(null)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('File object is required')
      expect(result.fileInfo).toBeNull()
    })

    it('should handle undefined file input', () => {
      const result = validateFile(undefined)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('File object is required')
      expect(result.fileInfo).toBeNull()
    })

    it('should extract file extension correctly', () => {
      const pdfFile = { ...validFile, originalname: 'document.PDF' }
      const result = validateFile(pdfFile)

      expect(result.fileInfo.extension).toBe('pdf')
    })

    it('should handle file without extension', () => {
      const noExtFile = { ...validFile, originalname: 'document' }
      const result = validateFile(noExtFile)

      expect(result.fileInfo.extension).toBe('document')
    })

    it('should collect multiple validation errors', () => {
      const invalidFile = {
        originalname: '../malicious.exe',
        size: -1,
        mimetype: 'application/x-executable'
      }

      const result = validateFile(invalidFile, ['application/pdf'])

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(3)
      expect(result.errors).toContain(
        'File must have a valid size greater than 0'
      )
      expect(result.errors).toContain(
        "File MIME type 'application/x-executable' is not allowed. Allowed types: application/pdf"
      )
      expect(result.errors).toContain(
        'Filename contains invalid characters or path traversal sequences'
      )
    })
  })

  describe('getHealthInfo', () => {
    it('should return healthy status when service is accessible', async () => {
      const mockHealthData = { version: '1.2.3', status: 'healthy' }
      global.fetch.mockResolvedValueOnce(new MockResponse(mockHealthData))

      const result = await getHealthInfo()

      expect(result.healthy).toBe(true)
      expect(result.config).toEqual({
        baseUrl: 'https://test-cdp-uploader.gov.uk',
        bucketName: 'test-bucket',
        maxFileSize: 10485760,
        timeout: 30000
      })
      expect(result.version).toBe('1.2.3')
      expect(result.responseTime).toBeGreaterThan(0)

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test-cdp-uploader.gov.uk/health',
        expect.objectContaining({
          method: 'GET',
          timeout: 30000
        })
      )
    })

    it('should return unknown version when not provided', async () => {
      global.fetch.mockResolvedValueOnce(new MockResponse({}))

      const result = await getHealthInfo()

      expect(result.version).toBe('unknown')
    })

    it('should return unhealthy status when service fails', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Service unavailable'))

      const result = await getHealthInfo()

      expect(result.healthy).toBe(false)
      expect(result.config).toEqual({
        baseUrl: 'https://test-cdp-uploader.gov.uk',
        bucketName: 'test-bucket',
        maxFileSize: 10485760,
        timeout: 30000
      })
      expect(result.error).toBe('Service unavailable')
      expect(result.responseTime).toBeGreaterThan(0)
    })
  })

  describe('API retry logic with exponential backoff', () => {
    it('should retry failed requests with exponential backoff', async () => {
      // Mock setTimeout to speed up tests
      vi.spyOn(global, 'setTimeout').mockImplementation((callback) =>
        callback()
      )

      // First two calls fail, third succeeds
      global.fetch
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(new MockResponse({ uploadId: 'success' }))

      const result = await initiateUpload({
        formPath: '/forms/test',
        retrievalKey: 'test-key'
      })

      expect(result.uploadId).toBe('success')
      expect(global.fetch).toHaveBeenCalledTimes(3)
      expect(logger.warn).toHaveBeenCalledTimes(2)
      expect(logger.warn).toHaveBeenCalledWith(
        'CDP API request failed (attempt 1/3)',
        expect.objectContaining({
          method: 'POST',
          error: 'Network timeout'
        })
      )

      global.setTimeout.mockRestore()
    })

    it('should fail after maximum retry attempts', async () => {
      vi.spyOn(global, 'setTimeout').mockImplementation((callback) =>
        callback()
      )

      global.fetch
        .mockRejectedValueOnce(new Error('Network error 1'))
        .mockRejectedValueOnce(new Error('Network error 2'))
        .mockRejectedValueOnce(new Error('Network error 3'))

      await expect(
        initiateUpload({
          formPath: '/forms/test',
          retrievalKey: 'test-key'
        })
      ).rejects.toThrow('Upload initiation failed: Network error 3')

      expect(global.fetch).toHaveBeenCalledTimes(3)
      expect(logger.warn).toHaveBeenCalledTimes(3)

      global.setTimeout.mockRestore()
    })

    it('should calculate correct exponential backoff delays', async () => {
      const setTimeoutSpy = vi
        .spyOn(global, 'setTimeout')
        .mockImplementation((callback) => callback())

      global.fetch
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockResolvedValueOnce(new MockResponse({ success: true }))

      await initiateUpload({
        formPath: '/forms/test',
        retrievalKey: 'test-key'
      })

      // Check that setTimeout was called with correct delays
      expect(setTimeoutSpy).toHaveBeenCalledTimes(2)
      // First retry: 2^0 * 1000 = 1000ms
      // Second retry: 2^1 * 1000 = 2000ms
      expect(setTimeoutSpy.mock.calls[0][1]).toBe(1000)
      expect(setTimeoutSpy.mock.calls[1][1]).toBe(2000)

      global.setTimeout.mockRestore()
    })

    it('should cap retry delay at maximum value', async () => {
      // Mock config to have more retry attempts
      config.get = vi.fn((key) => {
        if (key === 'cdpUploader') {
          return {
            ...mockConfig.cdpUploader,
            retryAttempts: 10
          }
        }
        return null
      })

      const setTimeoutSpy = vi
        .spyOn(global, 'setTimeout')
        .mockImplementation((callback) => callback())

      // Make multiple failures to test maximum delay cap
      for (let i = 0; i < 10; i++) {
        global.fetch.mockRejectedValueOnce(new Error(`Error ${i}`))
      }

      try {
        await initiateUpload({
          formPath: '/forms/test',
          retrievalKey: 'test-key'
        })
      } catch (error) {
        // Expected to fail
      }

      // Check that the delay is capped at 10000ms (10 seconds)
      const delays = setTimeoutSpy.mock.calls.map((call) => call[1])
      const maxDelay = Math.max(...delays)
      expect(maxDelay).toBeLessThanOrEqual(10000)

      global.setTimeout.mockRestore()
    })
  })

  describe('Network failure error handling', () => {
    it('should handle network timeout errors', async () => {
      global.fetch.mockRejectedValue(new Error('Request timeout'))

      await expect(
        initiateUpload({
          formPath: '/forms/test',
          retrievalKey: 'test-key'
        })
      ).rejects.toThrow('Upload initiation failed: Request timeout')
    })

    it('should handle connection refused errors', async () => {
      global.fetch.mockRejectedValue(new Error('connect ECONNREFUSED'))

      await expect(getUploadStatus('upload-123')).rejects.toThrow(
        'Status check failed: connect ECONNREFUSED'
      )
    })

    it('should handle DNS resolution errors', async () => {
      global.fetch.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))

      await expect(deleteUpload('upload-123')).rejects.toThrow(
        'Upload deletion failed: getaddrinfo ENOTFOUND'
      )
    })

    it('should handle JSON parsing errors', async () => {
      const invalidJsonResponse = new MockResponse('Invalid JSON response')
      invalidJsonResponse.json = vi
        .fn()
        .mockRejectedValue(new Error('Unexpected end of JSON input'))

      global.fetch.mockReset()
      global.fetch.mockResolvedValue(invalidJsonResponse)

      await expect(
        initiateUpload({
          formPath: '/forms/test',
          retrievalKey: 'test-key'
        })
      ).rejects.toThrow(
        'Upload initiation failed: Unexpected end of JSON input'
      )
    })
  })

  describe('Edge cases and validation', () => {
    it('should handle empty string parameters', async () => {
      await expect(
        initiateUpload({
          formPath: '',
          retrievalKey: 'test-key'
        })
      ).rejects.toThrow('formPath is required for upload initiation')

      await expect(
        initiateUpload({
          formPath: '/forms/test',
          retrievalKey: ''
        })
      ).rejects.toThrow('retrievalKey is required for upload initiation')
    })

    it('should handle very large file sizes', () => {
      const hugeFile = {
        originalname: 'huge-file.zip',
        size: Number.MAX_SAFE_INTEGER,
        mimetype: 'application/zip'
      }

      const result = validateFile(hugeFile)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
        `File size ${Number.MAX_SAFE_INTEGER} exceeds maximum allowed size of 10485760 bytes`
      )
    })

    it('should handle special characters in filenames', () => {
      const specialCharFile = {
        originalname: 'test@file#with$special%.pdf',
        size: 1024,
        mimetype: 'application/pdf'
      }

      const result = validateFile(specialCharFile)

      expect(result.valid).toBe(true)
      expect(result.fileInfo.originalname).toBe('test@file#with$special%.pdf')
    })

    it('should handle unicode filenames', () => {
      const unicodeFile = {
        originalname: 'документ-тест-файл.pdf',
        size: 1024,
        mimetype: 'application/pdf'
      }

      const result = validateFile(unicodeFile)

      expect(result.valid).toBe(true)
      expect(result.fileInfo.originalname).toBe('документ-тест-файл.pdf')
    })

    it('should handle very long filenames', () => {
      const longFileName = 'a'.repeat(300) + '.pdf'
      const longNameFile = {
        originalname: longFileName,
        size: 1024,
        mimetype: 'application/pdf'
      }

      const result = validateFile(longNameFile)

      expect(result.valid).toBe(true)
      expect(result.fileInfo.originalname).toBe(longFileName)
    })

    it('should handle null/undefined metadata', async () => {
      const mockResponseData = {
        uploadId: 'test',
        uploadUrl: 'https://test.com'
      }
      global.fetch.mockResolvedValueOnce(new MockResponse(mockResponseData))

      await initiateUpload({
        formPath: '/forms/test',
        retrievalKey: 'test-key',
        metadata: null
      })

      const callBody = JSON.parse(global.fetch.mock.calls[0][1].body)
      expect(callBody.metadata).toEqual({})
    })

    it('should handle empty arrays for mimeTypes', async () => {
      const mockResponseData = {
        uploadId: 'test',
        uploadUrl: 'https://test.com'
      }
      global.fetch.mockResolvedValueOnce(new MockResponse(mockResponseData))

      await initiateUpload({
        formPath: '/forms/test',
        retrievalKey: 'test-key',
        mimeTypes: []
      })

      const callBody = JSON.parse(global.fetch.mock.calls[0][1].body)
      expect(callBody.allowedMimeTypes).toEqual([])
    })

    it('should handle API responses with missing fields', async () => {
      const incompleteResponse = { uploadId: 'test' } // Missing other fields
      global.fetch.mockResolvedValueOnce(new MockResponse(incompleteResponse))

      const result = await initiateUpload({
        formPath: '/forms/test',
        retrievalKey: 'test-key'
      })

      expect(result.uploadId).toBe('test')
      expect(result.uploadUrl).toBeUndefined()
    })
  })

  describe('Configuration initialization', () => {
    it('should initialize configuration only once', async () => {
      const mockResponseData = {
        uploadId: 'test1',
        uploadUrl: 'https://test1.com'
      }
      global.fetch.mockResolvedValue(new MockResponse(mockResponseData))

      // Make multiple calls
      await initiateUpload({ formPath: '/forms/test1', retrievalKey: 'key1' })
      await initiateUpload({ formPath: '/forms/test2', retrievalKey: 'key2' })
      await getUploadStatus('upload-123')

      // Config should only be called once
      expect(config.get).toHaveBeenCalledTimes(1)
      expect(config.get).toHaveBeenCalledWith('cdpUploader')
    })
  })

  describe('Request body construction', () => {
    it('should not include body for GET requests', async () => {
      global.fetch.mockResolvedValueOnce(
        new MockResponse({ status: 'completed' })
      )

      await getUploadStatus('upload-123')

      const fetchCall = global.fetch.mock.calls[0]
      const requestOptions = fetchCall[1]
      expect(requestOptions.body).toBeUndefined()
    })

    it('should not include body for DELETE requests', async () => {
      global.fetch.mockResolvedValueOnce(
        new MockResponse({ deletedAt: new Date().toISOString() })
      )

      await deleteUpload('upload-123')

      const fetchCall = global.fetch.mock.calls[0]
      const requestOptions = fetchCall[1]
      expect(requestOptions.body).toBeUndefined()
    })

    it('should include body for POST requests', async () => {
      global.fetch.mockResolvedValueOnce(new MockResponse({ uploadId: 'test' }))

      await initiateUpload({
        formPath: '/forms/test',
        retrievalKey: 'test-key'
      })

      const fetchCall = global.fetch.mock.calls[0]
      const requestOptions = fetchCall[1]
      expect(requestOptions.body).toBeDefined()
      expect(typeof requestOptions.body).toBe('string')
    })
  })
})
