import { vi, describe, test, expect, beforeEach } from 'vitest'
import { createReadStream, promises as fs } from 'fs'
import {
  BlobServiceClient,
  StorageSharedKeyCredential
} from '@azure/storage-blob'
import { ClientSecretCredential } from '@azure/identity'
import azureConfig from './azureConfig.js'
import azureBlobStorageService from './azureBlobStorage.js'

vi.mock('@azure/storage-blob', () => ({
  BlobServiceClient: vi.fn(),
  StorageSharedKeyCredential: vi.fn()
}))

vi.mock('@azure/identity', () => ({
  ClientSecretCredential: vi.fn()
}))

vi.mock('fs', () => ({
  createReadStream: vi.fn(),
  promises: {
    stat: vi.fn()
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

vi.mock('./azureConfig.js', () => ({
  default: {
    initialize: vi.fn(),
    get: vi.fn(),
    getConnectionType: vi.fn(),
    getContainerName: vi.fn(),
    getStagingContainer: vi.fn(),
    getArchiveContainer: vi.fn(),
    getRetryConfig: vi.fn(),
    getHealthStatus: vi.fn()
  }
}))

describe('azureBlobStorage', () => {
  let mockBlobServiceClient
  let mockContainerClient
  let mockBlockBlobClient

  beforeEach(() => {
    vi.clearAllMocks()

    mockBlockBlobClient = {
      url: 'https://testaccount.blob.core.windows.net/container/blob',
      uploadStream: vi.fn().mockResolvedValue({
        etag: 'test-etag',
        lastModified: new Date('2023-01-01'),
        contentMD5: 'test-md5',
        requestId: 'test-request-id'
      })
    }

    mockContainerClient = {
      getBlockBlobClient: vi.fn().mockReturnValue(mockBlockBlobClient),
      createIfNotExists: vi.fn().mockResolvedValue({ succeeded: true })
    }

    mockBlobServiceClient = {
      getContainerClient: vi.fn().mockReturnValue(mockContainerClient),
      listContainers: vi.fn().mockReturnValue({
        next: vi
          .fn()
          .mockResolvedValue({ done: false, value: { name: 'test-container' } })
      })
    }

    BlobServiceClient.fromConnectionString = vi
      .fn()
      .mockReturnValue(mockBlobServiceClient)
    BlobServiceClient.mockImplementation(() => mockBlobServiceClient)

    azureConfig.initialize.mockResolvedValue({ success: true })
    azureConfig.getConnectionType.mockReturnValue('connectionString')
    azureConfig.get.mockImplementation((key) => {
      const config = {
        connectionString: 'DefaultEndpointsProtocol=https;AccountName=test;',
        accountName: 'testaccount',
        blockSize: 4 * 1024 * 1024,
        maxConcurrency: 20,
        enableProgressTracking: false
      }
      return config[key]
    })
    azureConfig.getContainerName.mockReturnValue('test-container')
    azureConfig.getStagingContainer.mockReturnValue('test-staging')
    azureConfig.getArchiveContainer.mockReturnValue('test-archive')
    azureConfig.getRetryConfig.mockReturnValue({
      maxRetries: 3,
      retryDelayMs: 1000,
      maxRetryDelayMs: 60000
    })
    azureConfig.getHealthStatus.mockReturnValue({
      status: 'healthy',
      configLoaded: true
    })

    fs.stat.mockResolvedValue({ size: 1024 })
    createReadStream.mockReturnValue({ pipe: vi.fn() })
  })

  describe('initialize', () => {
    test('initializes with connection string', async () => {
      await azureBlobStorageService.initialize()

      expect(azureConfig.initialize).toHaveBeenCalled()
      expect(BlobServiceClient.fromConnectionString).toHaveBeenCalledWith(
        'DefaultEndpointsProtocol=https;AccountName=test;'
      )
    })

    test('initializes with account key', async () => {
      azureConfig.getConnectionType.mockReturnValue('accountKey')
      azureConfig.get.mockImplementation((key) => {
        if (key === 'accountName') return 'testaccount'
        if (key === 'accountKey') return 'testkey'
        return null
      })

      StorageSharedKeyCredential.mockReturnValue({})

      await azureBlobStorageService.initialize()

      expect(StorageSharedKeyCredential).toHaveBeenCalledWith(
        'testaccount',
        'testkey'
      )
      expect(BlobServiceClient).toHaveBeenCalled()
    })

    test('initializes with service principal', async () => {
      azureConfig.getConnectionType.mockReturnValue('servicePrincipal')
      azureConfig.get.mockImplementation((key) => {
        const config = {
          accountName: 'testaccount',
          tenantId: 'test-tenant',
          clientId: 'test-client',
          clientSecret: 'test-secret'
        }
        return config[key]
      })

      ClientSecretCredential.mockReturnValue({})

      await azureBlobStorageService.initialize()

      expect(ClientSecretCredential).toHaveBeenCalledWith(
        'test-tenant',
        'test-client',
        'test-secret'
      )
      expect(BlobServiceClient).toHaveBeenCalled()
    })

    test('throws error for unsupported connection type', async () => {
      azureConfig.getConnectionType.mockReturnValue('unsupported')

      await expect(azureBlobStorageService.initialize()).rejects.toThrow(
        'Unsupported connection type: unsupported'
      )
    })

    test('creates containers if they do not exist', async () => {
      await azureBlobStorageService.initialize()

      expect(mockBlobServiceClient.getContainerClient).toHaveBeenCalledTimes(3)
      expect(mockContainerClient.createIfNotExists).toHaveBeenCalledTimes(3)
    })
  })

  describe('uploadFile', () => {
    beforeEach(async () => {
      await azureBlobStorageService.initialize()
    })

    test('uploads file successfully', async () => {
      const result = await azureBlobStorageService.uploadFile(
        '/path/to/file.pdf',
        'test-container',
        'uploaded-file.pdf',
        { contentType: 'application/pdf', metadata: { userId: '123' } }
      )

      expect(result).toEqual({
        success: true,
        blobName: 'uploaded-file.pdf',
        containerName: 'test-container',
        url: 'https://testaccount.blob.core.windows.net/container/blob',
        etag: 'test-etag',
        lastModified: new Date('2023-01-01'),
        contentMD5: 'test-md5',
        fileSize: 1024,
        uploadTime: expect.any(Number),
        requestId: 'test-request-id'
      })

      expect(fs.stat).toHaveBeenCalledWith('/path/to/file.pdf')
      expect(createReadStream).toHaveBeenCalledWith('/path/to/file.pdf')
      expect(mockBlockBlobClient.uploadStream).toHaveBeenCalled()
    })

    test('throws error if not initialized', async () => {
      azureBlobStorageService.reset()

      await expect(
        azureBlobStorageService.uploadFile(
          '/path/to/file.pdf',
          'container',
          'blob.pdf'
        )
      ).rejects.toThrow(
        'Azure Blob Storage service not initialized. Call initialize() first.'
      )

      await azureBlobStorageService.initialize()
    })

    test('handles upload failure', async () => {
      mockBlockBlobClient.uploadStream.mockRejectedValue(
        new Error('Network error')
      )

      await expect(
        azureBlobStorageService.uploadFile(
          '/path/to/file.pdf',
          'container',
          'blob.pdf'
        )
      ).rejects.toThrow('Azure upload failed: Network error')
    })
  })

  describe('getMetrics', () => {
    test('returns service metrics', () => {
      const metrics = azureBlobStorageService.getMetrics()

      expect(metrics).toMatchObject({
        isInitialized: expect.any(Boolean),
        configuration: expect.any(Object),
        timestamp: expect.any(String),
        uploadsStarted: expect.any(Number),
        uploadsCompleted: expect.any(Number),
        uploadsFailed: expect.any(Number)
      })
    })
  })

  describe('getHealthStatus', () => {
    test('returns healthy status when initialized', async () => {
      await azureBlobStorageService.initialize()
      const health = await azureBlobStorageService.getHealthStatus()

      expect(health).toMatchObject({
        status: 'healthy',
        initialized: true,
        connectionTest: 'passed',
        timestamp: expect.any(String)
      })
    })

    test('returns unhealthy status when not initialized', async () => {
      azureBlobStorageService.reset()

      const health = await azureBlobStorageService.getHealthStatus()

      expect(health).toMatchObject({
        status: 'unhealthy',
        initialized: false,
        error: 'Service not initialized'
      })
    })
  })
})
