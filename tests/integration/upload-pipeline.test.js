import {
  describe,
  test,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll
} from 'vitest'
import { SpreadsheetValidator } from '../../src/server/services/spreadsheet-validator.js'
import { createConfigMocks } from '../mocks/external-services.js'

// Mock services - these will be properly mocked versions that work with the pipeline
class S3Service {
  async downloadFile(s3Key) {
    // This will be mocked in beforeEach
    return { stream: null, contentType: '', contentLength: 0 }
  }

  async deleteFile(s3Key) {
    // This will be mocked in beforeEach
    return true
  }

  async uploadFile(key, buffer, contentType) {
    // This will be mocked in beforeEach
    return { etag: 'test-etag', key }
  }
}

class CdpUploaderService {
  async uploadToS3(buffer, filename, contentType) {
    // This will be mocked in beforeEach
    return { uploadId: 'test-123', s3Key: 'test.xlsx' }
  }

  async getUploadStatus(uploadId) {
    // This will be mocked in beforeEach
    return { virusScanStatus: 'clean' }
  }

  async deleteUpload(uploadId) {
    // This will be mocked in beforeEach
    return true
  }
}

class AzureStorageService {
  async uploadFile(blobName, buffer, contentType, metadata) {
    // This will be mocked in beforeEach
    return { blobName, etag: 'azure-etag', url: 'https://test.com' }
  }

  async deleteFile(blobName) {
    // This will be mocked in beforeEach
    return true
  }
}

// Create a mock upload pipeline orchestrator
class UploadPipelineOrchestrator {
  constructor(cdpUploader, s3Service, azureService, validator) {
    this.cdpUploader = cdpUploader
    this.s3Service = s3Service
    this.azureService = azureService
    this.validator = validator
  }

  async processUpload(fileBuffer, filename, contentType, metadata = {}) {
    const pipeline = {
      stage: 'validation',
      uploadId: null,
      s3Key: null,
      azureBlob: null,
      errors: []
    }

    try {
      // Stage 1: File validation
      pipeline.stage = 'validation'
      const fileValidation = this.validator.validateFile({
        originalname: filename,
        size: fileBuffer.length,
        mimetype: contentType
      })

      if (!fileValidation.isValid) {
        pipeline.errors = fileValidation.errors
        throw new Error(
          `Validation failed: ${fileValidation.errors.join(', ')}`
        )
      }

      // Stage 2: Content validation
      pipeline.stage = 'content-validation'
      const contentValidation = await this.validator.validateSpreadsheetContent(
        fileBuffer,
        filename
      )

      if (!contentValidation.isValid) {
        pipeline.errors = contentValidation.errors
        throw new Error(
          `Content validation failed: ${contentValidation.errors.join(', ')}`
        )
      }

      // Stage 3: Upload to S3 via CDP
      pipeline.stage = 'cdp-upload'
      const cdpResult = await this.cdpUploader.uploadToS3(
        fileBuffer,
        filename,
        contentType
      )
      pipeline.uploadId = cdpResult.uploadId
      pipeline.s3Key = cdpResult.s3Key

      // Stage 4: Verify upload status
      pipeline.stage = 'status-check'
      const status = await this.cdpUploader.getUploadStatus(cdpResult.uploadId)
      if (status.virusScanStatus !== 'clean') {
        throw new Error(`Virus scan failed: ${status.virusScanStatus}`)
      }

      // Stage 5: Download from S3
      pipeline.stage = 's3-download'
      const s3Download = await this.s3Service.downloadFile(cdpResult.s3Key)

      // Convert stream to buffer for testing
      const chunks = []
      for await (const chunk of s3Download.stream) {
        chunks.push(chunk)
      }
      const downloadedBuffer = Buffer.concat(chunks)

      // Stage 6: Transfer to Azure
      pipeline.stage = 'azure-upload'
      const azureKey = `processed/${Date.now()}-${filename}`
      const azureResult = await this.azureService.uploadFile(
        azureKey,
        downloadedBuffer,
        contentType,
        {
          ...metadata,
          originalFilename: filename,
          uploadId: cdpResult.uploadId,
          processedAt: new Date().toISOString()
        }
      )
      pipeline.azureBlob = azureResult.blobName

      // Stage 7: Cleanup S3 (optional)
      pipeline.stage = 'cleanup'
      await this.s3Service.deleteFile(cdpResult.s3Key)

      pipeline.stage = 'completed'
      return {
        success: true,
        pipeline,
        cdpResult,
        azureResult,
        validation: {
          file: fileValidation,
          content: contentValidation
        }
      }
    } catch (error) {
      return {
        success: false,
        pipeline,
        error: error.message
      }
    }
  }

  async handleUploadFailure(pipeline, error) {
    const recovery = {
      cleanupActions: [],
      retryable: false
    }

    try {
      // Cleanup based on pipeline stage
      if (pipeline.uploadId) {
        recovery.cleanupActions.push('cdp-cleanup')
        await this.cdpUploader.deleteUpload(pipeline.uploadId).catch((err) => {
          recovery.cleanupError = err.message
        })
      }

      if (pipeline.s3Key) {
        recovery.cleanupActions.push('s3-cleanup')
        await this.s3Service.deleteFile(pipeline.s3Key).catch((err) => {
          recovery.cleanupError = err.message
        })
      }

      if (pipeline.azureBlob) {
        recovery.cleanupActions.push('azure-cleanup')
        await this.azureService.deleteFile(pipeline.azureBlob).catch((err) => {
          recovery.cleanupError = err.message
        })
      }

      // Determine if error is retryable
      recovery.retryable = this.isRetryableError(error)
    } catch (cleanupError) {
      recovery.cleanupError = cleanupError.message
    }

    return recovery
  }

  isRetryableError(error) {
    const retryableErrors = [
      'Network timeout',
      'Service unavailable',
      'Connection reset',
      'Temporary failure'
    ]
    return retryableErrors.some((retryable) =>
      error.message.includes(retryable)
    )
  }
}

describe('Upload Pipeline Integration Tests', () => {
  let cdpUploader, s3Service, azureService, validator, orchestrator
  let mockServices = {}

  beforeAll(() => {
    // Setup config mocks
    createConfigMocks()

    // Create service instances with mocked dependencies
    cdpUploader = new CdpUploaderService()
    s3Service = new S3Service()
    azureService = new AzureStorageService()
    validator = new SpreadsheetValidator()
    orchestrator = new UploadPipelineOrchestrator(
      cdpUploader,
      s3Service,
      azureService,
      validator
    )
  })

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock the external service calls
    mockServices = {
      cdpUpload: vi.spyOn(cdpUploader, 'uploadToS3'),
      cdpStatus: vi.spyOn(cdpUploader, 'getUploadStatus'),
      cdpDelete: vi.spyOn(cdpUploader, 'deleteUpload'),
      s3Download: vi.spyOn(s3Service, 'downloadFile'),
      s3Delete: vi.spyOn(s3Service, 'deleteFile'),
      azureUpload: vi.spyOn(azureService, 'uploadFile'),
      azureDelete: vi.spyOn(azureService, 'deleteFile'),
      validateFile: vi.spyOn(validator, 'validateFile'),
      validateContent: vi.spyOn(validator, 'validateSpreadsheetContent')
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Happy Path - Complete Pipeline', () => {
    test('should process Excel upload successfully through complete pipeline', async () => {
      // Setup mocks for successful flow
      mockServices.validateFile.mockReturnValue({
        isValid: true,
        errors: [],
        fileInfo: {
          originalName: 'test.xlsx',
          size: 1024,
          mimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          extension: 'xlsx'
        }
      })

      mockServices.validateContent.mockResolvedValue({
        isValid: true,
        errors: [],
        sheets: [
          {
            name: 'Sheet1',
            rowCount: 10,
            columnCount: 3,
            hasHeaders: true
          }
        ]
      })

      mockServices.cdpUpload.mockResolvedValue({
        uploadId: 'upload-123',
        s3Key: 'uploads/test-file.xlsx',
        bucket: 'test-bucket',
        etag: 'etag-123',
        location: 's3://test-bucket/uploads/test-file.xlsx'
      })

      mockServices.cdpStatus.mockResolvedValue({
        uploadId: 'upload-123',
        status: 'completed',
        virusScanStatus: 'clean'
      })

      // Mock readable stream for S3 download
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('test file content')
        }
      }

      mockServices.s3Download.mockResolvedValue({
        stream: mockStream,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        contentLength: 17
      })

      mockServices.azureUpload.mockResolvedValue({
        blobName: 'processed/test-file.xlsx',
        etag: 'azure-etag',
        requestId: 'req-456',
        url: 'https://storage.blob.core.windows.net/container/processed/test-file.xlsx'
      })

      mockServices.s3Delete.mockResolvedValue(true)

      const fileBuffer = Buffer.from('test file content')
      const filename = 'test.xlsx'
      const contentType =
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      const metadata = { submissionId: 'sub-123' }

      const result = await orchestrator.processUpload(
        fileBuffer,
        filename,
        contentType,
        metadata
      )

      expect(result.success).toBe(true)
      expect(result.pipeline.stage).toBe('completed')
      expect(result.cdpResult.uploadId).toBe('upload-123')
      expect(result.azureResult.blobName).toContain('processed/')

      // Verify all services were called in order
      expect(mockServices.validateFile).toHaveBeenCalledWith({
        originalname: filename,
        size: fileBuffer.length,
        mimetype: contentType
      })
      expect(mockServices.validateContent).toHaveBeenCalledWith(
        fileBuffer,
        filename
      )
      expect(mockServices.cdpUpload).toHaveBeenCalledWith(
        fileBuffer,
        filename,
        contentType
      )
      expect(mockServices.cdpStatus).toHaveBeenCalledWith('upload-123')
      expect(mockServices.s3Download).toHaveBeenCalledWith(
        'uploads/test-file.xlsx'
      )
      expect(mockServices.azureUpload).toHaveBeenCalled()
      expect(mockServices.s3Delete).toHaveBeenCalledWith(
        'uploads/test-file.xlsx'
      )
    })

    test('should process CSV upload successfully', async () => {
      mockServices.validateFile.mockReturnValue({
        isValid: true,
        errors: [],
        fileInfo: {
          originalName: 'data.csv',
          size: 512,
          mimeType: 'text/csv',
          extension: 'csv'
        }
      })

      mockServices.validateContent.mockResolvedValue({
        isValid: true,
        errors: [],
        sheets: [
          { name: 'CSV Data', rowCount: 5, columnCount: 3, hasHeaders: true }
        ]
      })

      mockServices.cdpUpload.mockResolvedValue({
        uploadId: 'csv-upload-456',
        s3Key: 'uploads/data.csv',
        bucket: 'test-bucket'
      })

      mockServices.cdpStatus.mockResolvedValue({
        virusScanStatus: 'clean'
      })

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('Name,Age,City\nJohn,25,London')
        }
      }

      mockServices.s3Download.mockResolvedValue({
        stream: mockStream,
        contentType: 'text/csv'
      })

      mockServices.azureUpload.mockResolvedValue({
        blobName: 'processed/data.csv',
        etag: 'csv-etag'
      })

      mockServices.s3Delete.mockResolvedValue(true)

      const result = await orchestrator.processUpload(
        Buffer.from('Name,Age,City\nJohn,25,London'),
        'data.csv',
        'text/csv'
      )

      expect(result.success).toBe(true)
      expect(result.pipeline.stage).toBe('completed')
    })
  })

  describe('Error Handling and Recovery', () => {
    test('should handle file validation failure', async () => {
      mockServices.validateFile.mockReturnValue({
        isValid: false,
        errors: ['File size exceeds limit', 'Invalid file type'],
        fileInfo: { originalName: 'large.pdf', size: 100000000 }
      })

      const result = await orchestrator.processUpload(
        Buffer.from('test'),
        'large.pdf',
        'application/pdf'
      )

      expect(result.success).toBe(false)
      expect(result.pipeline.stage).toBe('validation')
      expect(result.error).toContain('File size exceeds limit')
      expect(mockServices.cdpUpload).not.toHaveBeenCalled()
    })

    test('should handle content validation failure', async () => {
      mockServices.validateFile.mockReturnValue({
        isValid: true,
        errors: [],
        fileInfo: { originalName: 'corrupt.xlsx', size: 1024 }
      })

      mockServices.validateContent.mockResolvedValue({
        isValid: false,
        errors: ['Excel file is corrupted', 'No sheets found'],
        sheets: []
      })

      const result = await orchestrator.processUpload(
        Buffer.from('corrupt data'),
        'corrupt.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )

      expect(result.success).toBe(false)
      expect(result.pipeline.stage).toBe('content-validation')
      expect(result.error).toContain('Excel file is corrupted')
    })

    test('should handle CDP upload failure', async () => {
      mockServices.validateFile.mockReturnValue({
        isValid: true,
        errors: [],
        fileInfo: {}
      })
      mockServices.validateContent.mockResolvedValue({
        isValid: true,
        errors: [],
        sheets: []
      })

      mockServices.cdpUpload.mockRejectedValue(
        new Error('CDP service unavailable')
      )

      const result = await orchestrator.processUpload(
        Buffer.from('test'),
        'test.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )

      expect(result.success).toBe(false)
      expect(result.pipeline.stage).toBe('cdp-upload')
      expect(result.error).toBe('CDP service unavailable')
    })

    test('should handle virus scan failure', async () => {
      mockServices.validateFile.mockReturnValue({
        isValid: true,
        errors: [],
        fileInfo: {}
      })
      mockServices.validateContent.mockResolvedValue({
        isValid: true,
        errors: [],
        sheets: []
      })

      mockServices.cdpUpload.mockResolvedValue({
        uploadId: 'infected-123',
        s3Key: 'uploads/virus.xlsx'
      })

      mockServices.cdpStatus.mockResolvedValue({
        virusScanStatus: 'infected',
        quarantineReason: 'Malware detected'
      })

      const result = await orchestrator.processUpload(
        Buffer.from('malicious content'),
        'virus.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )

      expect(result.success).toBe(false)
      expect(result.pipeline.stage).toBe('status-check')
      expect(result.error).toContain('Virus scan failed')
    })

    test('should handle S3 download failure', async () => {
      mockServices.validateFile.mockReturnValue({
        isValid: true,
        errors: [],
        fileInfo: {}
      })
      mockServices.validateContent.mockResolvedValue({
        isValid: true,
        errors: [],
        sheets: []
      })
      mockServices.cdpUpload.mockResolvedValue({
        uploadId: 'upload-123',
        s3Key: 'missing-file.xlsx'
      })
      mockServices.cdpStatus.mockResolvedValue({ virusScanStatus: 'clean' })

      mockServices.s3Download.mockRejectedValue(new Error('File not found'))

      const result = await orchestrator.processUpload(
        Buffer.from('test'),
        'test.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )

      expect(result.success).toBe(false)
      expect(result.pipeline.stage).toBe('s3-download')
      expect(result.error).toBe('File not found')
    })

    test('should handle Azure upload failure', async () => {
      mockServices.validateFile.mockReturnValue({
        isValid: true,
        errors: [],
        fileInfo: {}
      })
      mockServices.validateContent.mockResolvedValue({
        isValid: true,
        errors: [],
        sheets: []
      })
      mockServices.cdpUpload.mockResolvedValue({
        uploadId: 'upload-123',
        s3Key: 'test.xlsx'
      })
      mockServices.cdpStatus.mockResolvedValue({ virusScanStatus: 'clean' })

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('test content')
        }
      }
      mockServices.s3Download.mockResolvedValue({ stream: mockStream })

      mockServices.azureUpload.mockRejectedValue(
        new Error('Azure storage quota exceeded')
      )

      const result = await orchestrator.processUpload(
        Buffer.from('test'),
        'test.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )

      expect(result.success).toBe(false)
      expect(result.pipeline.stage).toBe('azure-upload')
      expect(result.error).toBe('Azure storage quota exceeded')
    })
  })

  describe('Failure Recovery and Cleanup', () => {
    test('should cleanup resources after CDP upload failure', async () => {
      const pipeline = {
        stage: 'cdp-upload',
        uploadId: 'failed-upload-123',
        s3Key: null,
        azureBlob: null
      }

      mockServices.cdpDelete.mockResolvedValue(true)

      const recovery = await orchestrator.handleUploadFailure(
        pipeline,
        new Error('CDP failed')
      )

      expect(recovery.cleanupActions).toContain('cdp-cleanup')
      expect(mockServices.cdpDelete).toHaveBeenCalledWith('failed-upload-123')
    })

    test('should cleanup all resources after partial failure', async () => {
      const pipeline = {
        stage: 'azure-upload',
        uploadId: 'upload-123',
        s3Key: 'uploads/test.xlsx',
        azureBlob: null
      }

      mockServices.cdpDelete.mockResolvedValue(true)
      mockServices.s3Delete.mockResolvedValue(true)

      const recovery = await orchestrator.handleUploadFailure(
        pipeline,
        new Error('Azure failed')
      )

      expect(recovery.cleanupActions).toEqual(['cdp-cleanup', 's3-cleanup'])
      expect(mockServices.cdpDelete).toHaveBeenCalledWith('upload-123')
      expect(mockServices.s3Delete).toHaveBeenCalledWith('uploads/test.xlsx')
    })

    test('should handle cleanup failures gracefully', async () => {
      const pipeline = {
        stage: 'azure-upload',
        uploadId: 'upload-123',
        s3Key: 'uploads/test.xlsx',
        azureBlob: 'processed/test.xlsx'
      }

      mockServices.cdpDelete.mockRejectedValue(new Error('CDP cleanup failed'))
      mockServices.s3Delete.mockResolvedValue(true)
      mockServices.azureDelete.mockRejectedValue(
        new Error('Azure cleanup failed')
      )

      const recovery = await orchestrator.handleUploadFailure(
        pipeline,
        new Error('Test failure')
      )

      expect(recovery.cleanupActions).toEqual([
        'cdp-cleanup',
        's3-cleanup',
        'azure-cleanup'
      ])
      expect(recovery.cleanupError).toBeDefined()
    })

    test('should identify retryable errors correctly', () => {
      const retryableErrors = [
        new Error('Network timeout occurred'),
        new Error('Service unavailable - please retry'),
        new Error('Connection reset by peer'),
        new Error('Temporary failure in name resolution')
      ]

      const nonRetryableErrors = [
        new Error('Invalid credentials'),
        new Error('File not found'),
        new Error('Quota exceeded'),
        new Error('Validation failed')
      ]

      retryableErrors.forEach((error) => {
        expect(orchestrator.isRetryableError(error)).toBe(true)
      })

      nonRetryableErrors.forEach((error) => {
        expect(orchestrator.isRetryableError(error)).toBe(false)
      })
    })
  })

  describe('Performance and Stress Tests', () => {
    test('should handle large file processing', async () => {
      const largeBuffer = Buffer.alloc(10 * 1024 * 1024, 'test data') // 10MB file

      mockServices.validateFile.mockReturnValue({
        isValid: true,
        errors: [],
        fileInfo: {}
      })
      mockServices.validateContent.mockResolvedValue({
        isValid: true,
        errors: [],
        sheets: []
      })
      mockServices.cdpUpload.mockResolvedValue({
        uploadId: 'large-123',
        s3Key: 'large.xlsx'
      })
      mockServices.cdpStatus.mockResolvedValue({ virusScanStatus: 'clean' })

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          // Simulate chunked reading
          const chunkSize = 64 * 1024 // 64KB chunks
          for (let i = 0; i < largeBuffer.length; i += chunkSize) {
            yield largeBuffer.slice(i, i + chunkSize)
          }
        }
      }

      mockServices.s3Download.mockResolvedValue({ stream: mockStream })
      mockServices.azureUpload.mockResolvedValue({
        blobName: 'processed/large.xlsx'
      })
      mockServices.s3Delete.mockResolvedValue(true)

      const startTime = Date.now()
      const result = await orchestrator.processUpload(
        largeBuffer,
        'large.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
      const processingTime = Date.now() - startTime

      expect(result.success).toBe(true)
      expect(processingTime).toBeLessThan(30000) // Should complete within 30 seconds
    })

    test('should handle concurrent upload attempts', async () => {
      // Setup successful mocks
      mockServices.validateFile.mockReturnValue({
        isValid: true,
        errors: [],
        fileInfo: {}
      })
      mockServices.validateContent.mockResolvedValue({
        isValid: true,
        errors: [],
        sheets: []
      })
      mockServices.cdpUpload.mockResolvedValue({
        uploadId: 'concurrent',
        s3Key: 'test.xlsx'
      })
      mockServices.cdpStatus.mockResolvedValue({ virusScanStatus: 'clean' })

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('test content')
        }
      }
      mockServices.s3Download.mockResolvedValue({ stream: mockStream })
      mockServices.azureUpload.mockResolvedValue({
        blobName: 'processed/test.xlsx'
      })
      mockServices.s3Delete.mockResolvedValue(true)

      // Process 5 uploads concurrently
      const uploadPromises = Array(5)
        .fill(null)
        .map((_, index) =>
          orchestrator.processUpload(
            Buffer.from(`test content ${index}`),
            `file${index}.xlsx`,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          )
        )

      const results = await Promise.all(uploadPromises)

      expect(results.every((result) => result.success)).toBe(true)
      expect(mockServices.cdpUpload).toHaveBeenCalledTimes(5)
      expect(mockServices.azureUpload).toHaveBeenCalledTimes(5)
    })
  })

  describe('End-to-End Scenarios', () => {
    test('should handle complete workflow with metadata preservation', async () => {
      const metadata = {
        submissionId: 'sub-789',
        userId: 'user-456',
        formType: 'bat-rabies',
        submittedAt: new Date().toISOString()
      }

      mockServices.validateFile.mockReturnValue({
        isValid: true,
        errors: [],
        fileInfo: {}
      })
      mockServices.validateContent.mockResolvedValue({
        isValid: true,
        errors: [],
        sheets: []
      })
      mockServices.cdpUpload.mockResolvedValue({
        uploadId: 'meta-123',
        s3Key: 'meta.xlsx'
      })
      mockServices.cdpStatus.mockResolvedValue({ virusScanStatus: 'clean' })

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('test content')
        }
      }
      mockServices.s3Download.mockResolvedValue({ stream: mockStream })
      mockServices.s3Delete.mockResolvedValue(true)

      // Capture the metadata passed to Azure
      mockServices.azureUpload.mockImplementation(
        async (blobName, buffer, contentType, azureMetadata) => {
          expect(azureMetadata).toEqual(
            expect.objectContaining({
              ...metadata,
              originalFilename: 'test.xlsx',
              uploadId: 'meta-123',
              processedAt: expect.any(String)
            })
          )
          return { blobName: 'processed/test.xlsx' }
        }
      )

      const result = await orchestrator.processUpload(
        Buffer.from('test content'),
        'test.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        metadata
      )

      expect(result.success).toBe(true)
      expect(mockServices.azureUpload).toHaveBeenCalledWith(
        expect.stringContaining('processed/'),
        expect.any(Buffer),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        expect.objectContaining(metadata)
      )
    })
  })
})
