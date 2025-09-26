import { vi } from 'vitest'

/**
 * Mock factory for external upload services
 * Provides consistent mocking patterns across all test files
 */

// CDP Uploader Service Mocks
export const createCdpUploaderMocks = () => {
  const mockFetch = vi.fn()
  const mockFormData = {
    append: vi.fn(),
    getHeaders: vi.fn(() => ({ 'content-type': 'multipart/form-data' }))
  }

  vi.stubGlobal('fetch', mockFetch)
  vi.mock('form-data', () => ({
    default: class MockFormData {
      constructor() {
        return mockFormData
      }
    }
  }))

  return {
    mockFetch,
    mockFormData,
    mockSuccessfulUpload: (
      uploadId = 'test-upload-123',
      s3Key = 'uploads/test.xlsx'
    ) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          uploadId,
          s3Key,
          bucket: 'test-bucket',
          etag: 'test-etag',
          location: `s3://test-bucket/${s3Key}`
        })
      })
    },
    mockUploadFailure: (status = 500, message = 'Internal Server Error') => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status,
        text: vi.fn().mockResolvedValue(message)
      })
    },
    mockUploadStatus: (status = 'completed', virusScanStatus = 'clean') => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          uploadId: 'test-upload-123',
          status,
          virusScanStatus,
          s3Location: 's3://test-bucket/uploads/test.xlsx'
        })
      })
    },
    mockNetworkError: (error = 'ECONNRESET') => {
      mockFetch.mockRejectedValue(new Error(error))
    }
  }
}

// S3 Service Mocks
export const createS3ServiceMocks = () => {
  const mockS3Client = { send: vi.fn() }

  vi.mock('@aws-sdk/client-s3', () => ({
    S3Client: vi.fn(() => mockS3Client),
    GetObjectCommand: vi.fn((params) => ({ type: 'GetObject', ...params })),
    PutObjectCommand: vi.fn((params) => ({ type: 'PutObject', ...params })),
    DeleteObjectCommand: vi.fn((params) => ({
      type: 'DeleteObject',
      ...params
    }))
  }))

  const mockGetSignedUrl = vi.fn()
  vi.doMock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: mockGetSignedUrl
  }))

  return {
    mockS3Client,
    mockGetSignedUrl,
    mockSuccessfulUpload: (etag = 'test-etag') => {
      mockS3Client.send.mockResolvedValueOnce({ ETag: etag })
    },
    mockSuccessfulDownload: (content = 'test content') => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(content)
        }
      }
      mockS3Client.send.mockResolvedValueOnce({
        Body: mockStream,
        ContentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ContentLength: Buffer.from(content).length,
        LastModified: new Date(),
        Metadata: { submissionId: 'test-123' }
      })
    },
    mockFileNotFound: () => {
      const error = new Error('NoSuchKey: The specified key does not exist')
      error.name = 'NoSuchKey'
      mockS3Client.send.mockRejectedValue(error)
    },
    mockAccessDenied: () => {
      const error = new Error('AccessDenied: Access Denied')
      error.name = 'AccessDenied'
      mockS3Client.send.mockRejectedValue(error)
    },
    mockNetworkError: (message = 'NetworkingError: socket hang up') => {
      mockS3Client.send.mockRejectedValue(new Error(message))
    },
    mockSignedUrlSuccess: (
      url = 'https://test-bucket.s3.amazonaws.com/file.xlsx?signature=abc123'
    ) => {
      mockGetSignedUrl.mockResolvedValue(url)
    }
  }
}

// Azure Storage Service Mocks
export const createAzureStorageMocks = () => {
  const mockBlockBlobClient = {
    upload: vi.fn(),
    download: vi.fn(),
    deleteIfExists: vi.fn(),
    url: 'https://test.blob.core.windows.net/container/file.xlsx'
  }

  const mockContainerClient = {
    createIfNotExists: vi.fn(),
    getBlockBlobClient: vi.fn(() => mockBlockBlobClient),
    listBlobsFlat: vi.fn()
  }

  const mockBlobServiceClient = {
    getContainerClient: vi.fn(() => mockContainerClient),
    credential: { accountKey: 'test-key' }
  }

  vi.mock('@azure/storage-blob', () => ({
    BlobServiceClient: {
      fromConnectionString: vi.fn(() => mockBlobServiceClient)
    },
    generateBlobSASQueryParameters: vi.fn(() => ({
      toString: () => 'sas-token'
    })),
    BlobSASPermissions: {
      parse: vi.fn(() => ({ read: true }))
    }
  }))

  return {
    mockBlobServiceClient,
    mockContainerClient,
    mockBlockBlobClient,
    mockSuccessfulUpload: (etag = 'azure-etag', requestId = 'req-123') => {
      mockContainerClient.createIfNotExists.mockResolvedValueOnce({
        succeeded: true
      })
      mockBlockBlobClient.upload.mockResolvedValueOnce({ etag, requestId })
    },
    mockSuccessfulDownload: (content = 'test content') => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(content)
        }
      }
      mockBlockBlobClient.download.mockResolvedValueOnce({
        readableStreamBody: mockStream,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        contentLength: Buffer.from(content).length,
        lastModified: new Date(),
        metadata: { submissionId: 'test-123' }
      })
    },
    mockFileNotFound: () => {
      const error = new Error('BlobNotFound: The specified blob does not exist')
      error.statusCode = 404
      mockBlockBlobClient.download.mockRejectedValue(error)
    },
    mockAccessDenied: () => {
      const error = new Error(
        'AuthenticationFailed: Server failed to authenticate the request'
      )
      error.statusCode = 403
      mockBlockBlobClient.upload.mockRejectedValue(error)
    },
    mockQuotaExceeded: () => {
      mockBlockBlobClient.upload.mockRejectedValue(
        new Error('AccountStorageQuotaExceeded: Storage quota exceeded')
      )
    },
    mockNetworkError: (message = 'ECONNREFUSED: Connection refused') => {
      mockContainerClient.createIfNotExists.mockRejectedValue(
        new Error(message)
      )
    },
    mockListBlobs: (blobs = []) => {
      mockContainerClient.listBlobsFlat.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const blob of blobs) {
            yield blob
          }
        }
      })
    }
  }
}

// Spreadsheet Validator Mocks
export const createSpreadsheetValidatorMocks = () => {
  const mockXLSX = {
    read: vi.fn(),
    utils: {
      decode_range: vi.fn(),
      sheet_to_json: vi.fn()
    }
  }

  const mockCsvStream = {
    pipe: vi.fn(() => mockCsvStream),
    on: vi.fn((event, callback) => {
      if (event === 'end') {
        setTimeout(callback, 0)
      }
      return mockCsvStream
    })
  }

  vi.mock('xlsx', () => ({ default: mockXLSX }))
  vi.mock('csv-parser', () => ({ default: vi.fn(() => mockCsvStream) }))
  vi.mock('mime-types', () => ({
    lookup: vi.fn((filename) => {
      const ext = filename.split('.').pop()?.toLowerCase()
      const mimeMap = {
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        xls: 'application/vnd.ms-excel',
        csv: 'text/csv'
      }
      return mimeMap[ext] || 'application/octet-stream'
    })
  }))

  return {
    mockXLSX,
    mockCsvStream,
    mockValidExcelFile: (sheetNames = ['Sheet1'], rowCount = 10) => {
      const mockWorkbook = {
        SheetNames: sheetNames,
        Sheets: {}
      }

      sheetNames.forEach((sheetName) => {
        mockWorkbook.Sheets[sheetName] = { '!ref': 'A1:C10' }
      })

      mockXLSX.read.mockReturnValue(mockWorkbook)
      mockXLSX.utils.decode_range.mockReturnValue({ e: { c: 2 } })
      mockXLSX.utils.sheet_to_json.mockReturnValue(
        Array(rowCount)
          .fill(null)
          .map((_, i) => [`Row${i}Col1`, `Row${i}Col2`, `Row${i}Col3`])
      )
    },
    mockCorruptExcelFile: (errorMessage = 'Invalid file format') => {
      mockXLSX.read.mockImplementation(() => {
        throw new Error(errorMessage)
      })
    },
    mockEmptyExcelFile: () => {
      mockXLSX.read.mockReturnValue({ SheetNames: [], Sheets: {} })
    },
    mockValidCsvFile: (rowCount = 5, columnCount = 3) => {
      mockCsvStream.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          for (let i = 0; i < rowCount; i++) {
            const row = {}
            for (let j = 0; j < columnCount; j++) {
              row[`col${j}`] = `value${i}-${j}`
            }
            callback(row)
          }
        } else if (event === 'end') {
          setTimeout(callback, 0)
        }
        return mockCsvStream
      })
    },
    mockCorruptCsvFile: (errorMessage = 'Malformed CSV') => {
      mockCsvStream.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          setTimeout(() => callback(new Error(errorMessage)), 0)
        }
        return mockCsvStream
      })
    }
  }
}

// Configuration Mocks
export const createConfigMocks = (overrides = {}) => {
  const defaultConfig = {
    'storage.cdpUploader.endpoint': 'https://test-uploader.service.gov.uk',
    'storage.cdpUploader.apiKey': 'test-api-key',
    'storage.s3.region': 'eu-west-2',
    'storage.s3.accessKeyId': 'test-access-key',
    'storage.s3.secretAccessKey': 'test-secret-key',
    'storage.s3.bucket': 'test-bucket',
    'storage.azure.connectionString':
      'DefaultEndpointsProtocol=https;AccountName=test;AccountKey=key;EndpointSuffix=core.windows.net',
    'storage.azure.containerName': 'test-container',
    'storage.maxFileSize': 52428800, // 50MB
    'storage.allowedMimeTypes': [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ]
  }

  const configMap = { ...defaultConfig, ...overrides }

  vi.mock('../../../src/config/config.js', () => ({
    config: {
      get: vi.fn((key) => configMap[key])
    }
  }))

  return {
    configMap,
    updateConfig: (key, value) => {
      configMap[key] = value
    }
  }
}

// Test Data Generators
export const createTestFiles = () => ({
  validExcelFile: {
    buffer: Buffer.from('test excel content'),
    filename: 'test.xlsx',
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: 1024
  },
  validCsvFile: {
    buffer: Buffer.from('Name,Age,City\nJohn,25,London\nJane,30,Paris'),
    filename: 'data.csv',
    contentType: 'text/csv',
    size: 45
  },
  largeCsvFile: {
    buffer: Buffer.from('header1,header2\n' + 'value1,value2\n'.repeat(10000)),
    filename: 'large.csv',
    contentType: 'text/csv',
    size: 210000
  },
  oversizedFile: {
    buffer: Buffer.alloc(60 * 1024 * 1024), // 60MB
    filename: 'huge.xlsx',
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: 60 * 1024 * 1024
  },
  invalidTypeFile: {
    buffer: Buffer.from('test content'),
    filename: 'document.pdf',
    contentType: 'application/pdf',
    size: 1024
  },
  corruptFile: {
    buffer: Buffer.from('not a valid file'),
    filename: 'corrupt.xlsx',
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: 15
  },
  emptyFile: {
    buffer: Buffer.alloc(0),
    filename: 'empty.xlsx',
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: 0
  }
})

// Utility for generating test metadata
export const createTestMetadata = (overrides = {}) => ({
  submissionId: 'sub-123',
  userId: 'user-456',
  formType: 'bat-rabies',
  submittedAt: new Date().toISOString(),
  ...overrides
})

// Error simulation utilities
export const createErrorScenarios = () => ({
  networkTimeout: () =>
    new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('ETIMEDOUT: Connection timeout')), 100)
    }),
  connectionRefused: () =>
    Promise.reject(new Error('ECONNREFUSED: Connection refused')),
  dnsFailure: () =>
    Promise.reject(new Error('ENOTFOUND: getaddrinfo ENOTFOUND')),
  sslError: () =>
    Promise.reject(new Error('CERT_UNTRUSTED: certificate not trusted')),
  quotaExceeded: () =>
    Promise.reject(new Error('QuotaExceeded: Storage quota exceeded')),
  authenticationFailed: () =>
    Promise.reject(new Error('AuthenticationFailed: Invalid credentials')),
  serviceUnavailable: () =>
    Promise.reject(
      new Error('ServiceUnavailable: Service temporarily unavailable')
    ),
  rateLimitExceeded: () =>
    Promise.reject(new Error('TooManyRequests: Rate limit exceeded')),
  corruptedData: () =>
    Promise.reject(new Error('DataCorruption: File content is corrupted')),
  insufficientPermissions: () =>
    Promise.reject(new Error('PermissionDenied: Insufficient permissions'))
})

// Test assertion helpers
export const assertUploadSuccess = (result) => {
  expect(result).toBeDefined()
  expect(result).toHaveProperty('success', true)
  expect(result).toHaveProperty('uploadId')
  expect(result).toHaveProperty('location')
}

export const assertUploadFailure = (result, expectedError) => {
  expect(result).toBeDefined()
  expect(result).toHaveProperty('success', false)
  if (expectedError) {
    expect(result.error).toContain(expectedError)
  }
}

export const assertValidationSuccess = (validation) => {
  expect(validation.isValid).toBe(true)
  expect(validation.errors).toHaveLength(0)
  expect(validation.sheets).toBeDefined()
}

export const assertValidationFailure = (validation, expectedErrors = []) => {
  expect(validation.isValid).toBe(false)
  expect(validation.errors.length).toBeGreaterThan(0)
  if (expectedErrors.length > 0) {
    expectedErrors.forEach((error) => {
      expect(validation.errors.some((e) => e.includes(error))).toBe(true)
    })
  }
}
