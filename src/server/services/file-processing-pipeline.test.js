import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Readable } from 'stream'
import {
  processUploadedFile,
  transferFileFromS3ToAzure,
  validateFileIntegrity,
  processFileMetadata,
  cleanupStagingFile,
  getProcessingStatus,
  __clearActiveProcesses
} from './file-processing-pipeline.js'

import azureStorageService from './azure-storage-service.js'
import cdpUploaderClient from './cdp-uploader-client.js'
import uploadSecurity from './upload-security.js'
import { logger } from '../common/helpers/logging/logger.js'
import { config } from '../../config/config.js'

vi.mock('./azure-storage-service.js', () => ({
  default: {
    uploadFileToBlob: vi.fn(),
    uploadFileFromStream: vi.fn(),
    uploadMetadata: vi.fn(),
    getStorageMetrics: vi.fn()
  }
}))

vi.mock('./cdp-uploader-client.js', () => ({
  default: {
    downloadFile: vi.fn(),
    deleteUpload: vi.fn()
  }
}))

vi.mock('./upload-security.js', () => ({
  default: {
    validateFileContent: vi.fn()
  }
}))

vi.mock('../common/helpers/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock('../../config/config.js', () => ({
  config: {
    get: vi.fn()
  }
}))

describe('File Processing Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __clearActiveProcesses()
    vi.resetModules()

    config.get.mockImplementation((key) => {
      const configMap = {
        azureStorage: {
          containerName: 'test-container',
          processingTimeout: 30000
        },
        cdpUploader: {
          bucketName: 'test-bucket',
          stagingPrefix: 'staging/'
        },
        isProduction: false,
        isDevelopment: true
      }
      return configMap[key]
    })

    uploadSecurity.validateFileContent.mockReturnValue({
      valid: true,
      checksum: 'abc123',
      threats: []
    })

    azureStorageService.uploadFileToBlob.mockResolvedValue({
      success: true,
      blobUrl: 'https://test.blob.core.windows.net/container/file.txt',
      etag: 'test-etag',
      lastModified: new Date().toISOString()
    })

    azureStorageService.uploadFileFromStream.mockResolvedValue({
      success: true,
      url: 'https://test.blob.core.windows.net/container/file.txt',
      etag: 'test-etag',
      lastModified: new Date().toISOString()
    })

    azureStorageService.uploadMetadata.mockResolvedValue({
      metadataUrl: 'https://test.blob.core.windows.net/container/metadata.json'
    })

    cdpUploaderClient.downloadFile.mockResolvedValue({
      stream: Readable.from(Buffer.from('test file content')),
      metadata: { size: 17 }
    })

    cdpUploaderClient.deleteUpload.mockResolvedValue({ success: true })
  })

  describe('processUploadedFile', () => {
    const validCallbackData = {
      uploadId: 'test-upload-123',
      status: 'completed',
      retrievalKey: 'test-key',
      fileInfo: {
        originalName: 'test.txt',
        name: 'test.txt',
        size: 1024,
        mimetype: 'text/plain'
      }
    }

    it('processes completed upload successfully', async () => {
      const result = await processUploadedFile(validCallbackData)

      expect(result).toEqual({
        success: true,
        uploadId: 'test-upload-123',
        azureUrl: 'https://test.blob.core.windows.net/container/file.txt',
        metadata: {
          originalName: 'test.txt',
          formData: null
        },
        processedAt: expect.any(String)
      })
    })

    it('handles failed status callback', async () => {
      const failedCallback = {
        ...validCallbackData,
        status: 'failed',
        error: 'Upload failed'
      }

      const result = await processUploadedFile(failedCallback)

      expect(result).toEqual({
        success: false,
        uploadId: 'test-upload-123',
        error: 'Upload failed',
        processedAt: expect.any(String)
      })
    })

    it('handles rejected status with virus detection', async () => {
      const rejectedCallback = {
        ...validCallbackData,
        status: 'rejected',
        virusScanResult: 'infected'
      }

      const result = await processUploadedFile(rejectedCallback)

      expect(result).toEqual({
        success: false,
        uploadId: 'test-upload-123',
        error: 'File rejected: Virus detected',
        virusScanResult: 'infected',
        processedAt: expect.any(String)
      })

      expect(cdpUploaderClient.deleteUpload).toHaveBeenCalledWith(
        'test-upload-123'
      )
    })

    it('handles infected file status', async () => {
      const infectedCallback = {
        ...validCallbackData,
        virusScanResult: 'infected'
      }

      const result = await processUploadedFile(infectedCallback)

      expect(result).toEqual({
        success: false,
        uploadId: 'test-upload-123',
        error: 'File rejected: Virus detected',
        virusScanResult: 'infected',
        processedAt: expect.any(String)
      })
    })

    it('throws for unsupported status', async () => {
      const unsupportedCallback = {
        ...validCallbackData,
        status: 'unknown'
      }

      await expect(processUploadedFile(unsupportedCallback)).rejects.toThrow(
        'Unsupported status: unknown'
      )
    })

    it('throws for invalid callback data', async () => {
      await expect(processUploadedFile(null)).rejects.toThrow(
        'Invalid callback data'
      )

      await expect(processUploadedFile('invalid')).rejects.toThrow(
        'Invalid callback data'
      )
    })

    it('throws for missing required fields', async () => {
      const incompleteCallback = {
        status: 'completed'
      }

      await expect(processUploadedFile(incompleteCallback)).rejects.toThrow(
        'Invalid callback data: missing required fields'
      )
    })

    it('throws for malformed data', async () => {
      const malformedCallback = {
        uploadId: null,
        status: 'completed',
        retrievalKey: 'test-key',
        fileInfo: 'invalid'
      }

      await expect(processUploadedFile(malformedCallback)).rejects.toThrow(
        'Invalid callback data'
      )
    })

    it('prevents concurrent processing of same upload', async () => {
      const callback1 = { ...validCallbackData }
      const callback2 = { ...validCallbackData }

      const promise1 = processUploadedFile(callback1)
      await expect(processUploadedFile(callback2)).rejects.toThrow(
        'Upload test-upload-123 is already being processed'
      )

      await promise1
    })

    it('processes with form data', async () => {
      const formData = { field1: 'value1', field2: 'value2' }
      const result = await processUploadedFile(validCallbackData, formData)

      expect(result.success).toBe(true)
      expect(result.metadata.formData).toEqual(formData)
    })

    it('throws for network errors', async () => {
      const networkErrorCallback = {
        ...validCallbackData,
        status: 'failed',
        error: 'Connection reset by peer'
      }

      await expect(processUploadedFile(networkErrorCallback)).rejects.toThrow(
        'Connection reset by peer'
      )
    })

    it('throws for storage quota errors', async () => {
      const quotaErrorCallback = {
        ...validCallbackData,
        status: 'failed',
        error: 'Insufficient storage quota'
      }

      await expect(processUploadedFile(quotaErrorCallback)).rejects.toThrow(
        'Insufficient storage quota'
      )
    })
  })

  describe('transferFileFromS3ToAzure', () => {
    const validTransferData = {
      s3Key: 'test-s3-key',
      azureContainer: 'test-container',
      azureBlobName: 'test-blob.txt',
      metadata: {
        originalName: 'test.txt',
        uploadId: 'test-upload-123',
        contentType: 'text/plain'
      }
    }

    it('transfers file successfully', async () => {
      const result = await transferFileFromS3ToAzure(validTransferData)

      expect(result).toEqual({
        success: true,
        azureUrl: 'https://test.blob.core.windows.net/container/file.txt',
        transferredBytes: expect.any(Number),
        duration: expect.any(Number),
        etag: 'test-etag',
        lastModified: expect.any(String)
      })

      expect(cdpUploaderClient.downloadFile).toHaveBeenCalledWith('test-s3-key')
      expect(azureStorageService.uploadFileFromStream).toHaveBeenCalled()
    })

    it('retries on failure', async () => {
      cdpUploaderClient.downloadFile
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          stream: Readable.from(Buffer.from('test content')),
          metadata: { size: 12 }
        })

      const result = await transferFileFromS3ToAzure(validTransferData)

      expect(result.success).toBe(true)
      expect(cdpUploaderClient.downloadFile).toHaveBeenCalledTimes(3)
    })

    it('fails after max retries', async () => {
      const error = new Error('Persistent error')
      cdpUploaderClient.downloadFile.mockRejectedValue(error)

      await expect(
        transferFileFromS3ToAzure(validTransferData)
      ).rejects.toThrow('Persistent error')

      expect(cdpUploaderClient.downloadFile).toHaveBeenCalledTimes(3)
    })

    it('handles ReadableStream properly', async () => {
      const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])]
      let chunkIndex = 0

      const mockReadableStream = new ReadableStream({
        pull(controller) {
          if (chunkIndex < chunks.length) {
            controller.enqueue(chunks[chunkIndex])
            chunkIndex++
          } else {
            controller.close()
          }
        }
      })

      cdpUploaderClient.downloadFile.mockResolvedValue({
        stream: mockReadableStream,
        metadata: { size: 6 }
      })

      const result = await transferFileFromS3ToAzure(validTransferData)

      expect(result.success).toBe(true)
      expect(result.transferredBytes).toBeGreaterThanOrEqual(0)
    })

    it('handles Node.js stream properly', async () => {
      const nodeStream = Readable.from(Buffer.from('test content'))

      cdpUploaderClient.downloadFile.mockResolvedValue({
        stream: nodeStream,
        metadata: { size: 12 }
      })

      const result = await transferFileFromS3ToAzure(validTransferData)

      expect(result.success).toBe(true)
    })

    it('handles missing download stream', async () => {
      cdpUploaderClient.downloadFile.mockResolvedValue({
        stream: null
      })

      await expect(
        transferFileFromS3ToAzure(validTransferData)
      ).rejects.toThrow('Failed to download file from S3')
    })
  })

  describe('validateFileIntegrity', () => {
    it('should validate file successfully', async () => {
      const fileData = {
        stream: Readable.from(Buffer.from('test content')),
        expectedChecksum: 'abc123',
        size: 12
      }

      const result = await validateFileIntegrity(fileData)

      expect(result).toEqual({
        valid: true,
        checksum: 'abc123',
        threats: [],
        size: expect.any(Number)
      })
    })

    it('should handle checksum mismatch', async () => {
      uploadSecurity.validateFileContent.mockReturnValue({
        valid: false,
        checksum: 'different123',
        threats: []
      })

      const fileData = {
        stream: Readable.from(Buffer.from('test content')),
        expectedChecksum: 'abc123',
        size: 12
      }

      const result = await validateFileIntegrity(fileData)

      expect(result).toEqual({
        valid: false,
        error: 'Checksum mismatch',
        expectedChecksum: 'abc123',
        actualChecksum: 'different123',
        threats: []
      })
    })

    it('should handle security threats', async () => {
      uploadSecurity.validateFileContent.mockReturnValue({
        valid: true,
        checksum: 'abc123',
        threats: ['malicious-script']
      })

      const fileData = {
        stream: Readable.from(Buffer.from('test content')),
        expectedChecksum: 'abc123',
        size: 12
      }

      const result = await validateFileIntegrity(fileData)

      expect(result).toEqual({
        valid: false,
        checksum: 'abc123',
        threats: ['malicious-script']
      })
    })

    it('should handle ReadableStream', async () => {
      const chunks = [new Uint8Array([1, 2, 3, 4])]
      let chunkIndex = 0

      const mockReadableStream = new ReadableStream({
        pull(controller) {
          if (chunkIndex < chunks.length) {
            controller.enqueue(chunks[chunkIndex])
            chunkIndex++
          } else {
            controller.close()
          }
        }
      })

      const fileData = {
        stream: mockReadableStream,
        expectedChecksum: 'abc123',
        size: 4
      }

      const result = await validateFileIntegrity(fileData)

      expect(result.valid).toBe(true)
    })

    it('should handle stream timeout', async () => {
      // Create a stream that never resolves
      const hangingStream = new ReadableStream({
        pull() {
          // Never call controller methods to simulate hanging
        }
      })

      const fileData = {
        stream: hangingStream,
        expectedChecksum: 'abc123',
        size: 12
      }

      const result = await validateFileIntegrity(fileData)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('timeout')
    }, 10000) // Increase timeout to 10 seconds to allow the function's 5-second timeout to complete

    it('should handle missing stream', async () => {
      const fileData = {
        stream: null,
        expectedChecksum: 'abc123',
        size: 12
      }

      const result = await validateFileIntegrity(fileData)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('No stream provided')
    })

    it('should handle pipeline timeout for Node.js streams', async () => {
      // Mock a slow stream that will timeout
      const slowStream = new Readable({
        read() {
          // Delay reading to trigger timeout
          setTimeout(() => {
            this.push(null) // End stream
          }, 6000) // Longer than 5 second timeout
        }
      })

      const fileData = {
        stream: slowStream,
        expectedChecksum: 'abc123',
        size: 12
      }

      const result = await validateFileIntegrity(fileData)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('timeout')
    }, 10000) // Increase timeout to 10 seconds to allow the function's 5-second timeout to complete
  })

  describe('processFileMetadata', () => {
    const validMetadata = {
      uploadId: 'test-upload-123',
      originalName: 'test.txt',
      size: 1024,
      mimetype: 'text/plain',
      formData: {
        field1: 'value1',
        password: 'secret123', // Should be sanitized
        apiKey: 'key123' // Should be sanitized
      }
    }

    it('should process metadata successfully', async () => {
      const result = await processFileMetadata(validMetadata)

      expect(result).toEqual({
        success: true,
        metadataUrl:
          'https://test.blob.core.windows.net/container/metadata.json',
        processedFields: expect.any(Number)
      })

      expect(azureStorageService.uploadMetadata).toHaveBeenCalledWith(
        'metadata/test-upload-123/metadata.json',
        expect.objectContaining({
          uploadId: 'test-upload-123',
          originalName: 'test.txt',
          formData: expect.not.objectContaining({
            password: expect.anything(),
            apiKey: expect.anything()
          })
        })
      )
    })

    it('should sanitize sensitive fields', async () => {
      await processFileMetadata(validMetadata)

      const uploadCall = azureStorageService.uploadMetadata.mock.calls[0][1]
      expect(uploadCall.formData).not.toHaveProperty('password')
      expect(uploadCall.formData).not.toHaveProperty('apiKey')
      expect(uploadCall.formData).toHaveProperty('field1', 'value1')
    })

    it('should handle metadata without form data', async () => {
      const metadataWithoutForm = {
        uploadId: 'test-upload-123',
        originalName: 'test.txt',
        size: 1024,
        mimetype: 'text/plain'
      }

      const result = await processFileMetadata(metadataWithoutForm)

      expect(result.success).toBe(true)
      expect(azureStorageService.uploadMetadata).toHaveBeenCalled()
    })

    it('should handle Azure upload failure', async () => {
      azureStorageService.uploadMetadata.mockRejectedValue(
        new Error('Azure error')
      )

      await expect(processFileMetadata(validMetadata)).rejects.toThrow(
        'Azure error'
      )
    })
  })

  describe('cleanupStagingFile', () => {
    it('should cleanup staging file successfully', async () => {
      const result = await cleanupStagingFile('test-s3-key')

      expect(result).toEqual({
        success: true,
        s3Key: 'test-s3-key',
        cleanedAt: expect.any(String)
      })

      expect(cdpUploaderClient.deleteUpload).toHaveBeenCalledWith('test-s3-key')
    })

    it('should handle cleanup failure gracefully', async () => {
      cdpUploaderClient.deleteUpload.mockRejectedValue(
        new Error('Delete failed')
      )

      const result = await cleanupStagingFile('test-s3-key')

      expect(result).toEqual({
        success: false,
        error: 'Delete failed',
        warning: true,
        s3Key: 'test-s3-key',
        attemptedAt: expect.any(String)
      })
    })
  })

  describe('getProcessingStatus', () => {
    it('should return null for unknown upload', () => {
      const result = getProcessingStatus('unknown-upload')

      expect(result).toBeNull()
    })

    it('should return mock status for test uploads', () => {
      const result = getProcessingStatus('active-transfer-123')

      expect(result).toEqual({
        uploadId: 'active-transfer-123',
        stage: 'processing',
        progress: 50,
        estimatedCompletion: expect.any(String)
      })
    })
  })

  describe('timeout handling', () => {
    beforeEach(() => {
      // Set a very short timeout for testing
      config.get.mockImplementation((key) => {
        if (key === 'azureStorage') {
          return {
            containerName: 'test-container',
            processingTimeout: 100 // 100ms timeout
          }
        }
        const configMap = {
          cdpUploader: {
            bucketName: 'test-bucket',
            stagingPrefix: 'staging/'
          },
          isProduction: false,
          isDevelopment: true
        }
        return configMap[key]
      })
    })

    it.skip('should timeout for long-running operations', async () => {
      // Make all async operations take longer than timeout by resolving after 150ms
      // CDP download mock
      cdpUploaderClient.downloadFile.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                stream: Readable.from(Buffer.from('test content')),
                metadata: { size: 12 }
              }),
            150
          ) // Resolve after 150ms, which is longer than 100ms timeout
        })
      })

      // Azure upload mock should also be slow
      azureStorageService.uploadFileFromStream.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                success: true,
                url: 'https://test.blob.core.windows.net/container/file.txt',
                etag: 'test-etag',
                lastModified: new Date().toISOString()
              }),
            150
          ) // Resolve after 150ms
        })
      })

      const validCallbackData = {
        uploadId: 'test-upload-timeout',
        status: 'completed',
        retrievalKey: 'test-key',
        fileInfo: {
          originalName: 'test.txt',
          name: 'test.txt',
          size: 1024,
          mimetype: 'text/plain'
        }
      }

      await expect(processUploadedFile(validCallbackData)).rejects.toThrow(
        'Processing timeout'
      )
    }, 1000) // Give test 1 second to complete (timeout is 100ms)
  })

  describe('concurrent processing prevention', () => {
    it('should prevent multiple concurrent processes for same upload', async () => {
      const callbackData = {
        uploadId: 'concurrent-test-123',
        status: 'completed',
        retrievalKey: 'test-key',
        fileInfo: {
          originalName: 'test.txt',
          name: 'test.txt',
          size: 1024,
          mimetype: 'text/plain'
        }
      }

      // Make the first process take some time
      azureStorageService.uploadFileFromStream.mockImplementation(() => {
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                success: true,
                url: 'https://test.blob.core.windows.net/container/file.txt',
                etag: 'test-etag',
                lastModified: new Date().toISOString()
              }),
            50
          )
        )
      })

      // Start first processing
      const promise1 = processUploadedFile(callbackData)

      // Try to start second processing immediately
      const promise2 = processUploadedFile(callbackData)

      // Second should fail immediately
      await expect(promise2).rejects.toThrow(
        'Upload concurrent-test-123 is already being processed'
      )

      // First should succeed
      const result1 = await promise1
      expect(result1.success).toBe(true)
    })

    it('should allow processing after previous completion', async () => {
      const callbackData = {
        uploadId: 'sequential-test-123',
        status: 'completed',
        retrievalKey: 'test-key',
        fileInfo: {
          originalName: 'test.txt',
          name: 'test.txt',
          size: 1024,
          mimetype: 'text/plain'
        }
      }

      // First processing
      const result1 = await processUploadedFile(callbackData)
      expect(result1.success).toBe(true)

      // Second processing should work after first is complete
      const result2 = await processUploadedFile(callbackData)
      expect(result2.success).toBe(true)
    })
  })

  describe('error handling edge cases', () => {
    it('should handle file integrity check failure', async () => {
      const callbackData = {
        uploadId: 'integrity-test-123',
        status: 'completed',
        retrievalKey: 'test-key',
        fileInfo: {
          originalName: 'test.txt',
          name: 'test.txt',
          size: 1024,
          mimetype: 'text/plain',
          checksum: 'expected-checksum'
        }
      }

      // Mock validation failure
      uploadSecurity.validateFileContent.mockReturnValue({
        valid: false,
        error: 'Checksum mismatch'
      })

      const result = await processUploadedFile(callbackData)

      expect(result.success).toBe(false)
      expect(result.error).toContain('File integrity check failed')
    })

    it('should handle cleanup failures without affecting main process', async () => {
      cdpUploaderClient.deleteUpload.mockRejectedValue(
        new Error('Cleanup failed')
      )

      const callbackData = {
        uploadId: 'cleanup-test-123',
        status: 'completed',
        retrievalKey: 'test-key',
        fileInfo: {
          originalName: 'test.txt',
          name: 'test.txt',
          size: 1024,
          mimetype: 'text/plain'
        }
      }

      // Should still succeed even if cleanup fails
      const result = await processUploadedFile(callbackData)
      expect(result.success).toBe(true)
      expect(logger.warn).toHaveBeenCalledWith(
        'Staging file cleanup failed',
        expect.any(Object)
      )
    })
  })
})
