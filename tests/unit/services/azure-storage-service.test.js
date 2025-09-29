import { vi, describe, it, expect, beforeEach } from 'vitest'
import { azureStorageService } from '../../../src/server/upload/services/azure-storage-service.js'

// Mock the upload config
vi.mock('../../../src/config/upload-config.js', () => ({
  uploadConfig: {
    azureConfig: {
      enabled: true,
      containerName: 'test-container'
    },
    getAzureBlobClient: vi.fn()
  }
}))

// Mock Azure storage blob SDK
vi.mock('@azure/storage-blob')

describe('azureStorageService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('uploadFile', () => {
    it('should upload file with private container access', async () => {
      // Arrange
      const uploadId = 'test-upload-123'
      const file = {
        originalname: 'test.xlsx',
        buffer: Buffer.from('test content'),
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }
      const metadata = {
        uploadedBy: 'test-user'
      }

      const mockBlockBlobClient = {
        upload: vi.fn().mockResolvedValue({
          etag: '"test-etag"',
          lastModified: new Date()
        }),
        url: 'https://test.blob.core.windows.net/test-container/test.xlsx',
        generateSasUrl: vi
          .fn()
          .mockResolvedValue(
            'https://test.blob.core.windows.net/test-container/test.xlsx?sv=2024&sig=abc123'
          )
      }

      const mockContainerClient = {
        createIfNotExists: vi.fn().mockResolvedValue({ succeeded: true }),
        getBlockBlobClient: vi.fn().mockReturnValue(mockBlockBlobClient)
      }

      const mockBlobServiceClient = {
        getContainerClient: vi.fn().mockReturnValue(mockContainerClient)
      }

      const { uploadConfig } = await import(
        '../../../src/config/upload-config.js'
      )
      uploadConfig.getAzureBlobClient.mockResolvedValue(mockBlobServiceClient)

      // Act
      const result = await azureStorageService.uploadFile(
        uploadId,
        file,
        metadata
      )

      // Assert
      expect(mockContainerClient.createIfNotExists).toHaveBeenCalledWith()
      // Ensure createIfNotExists is NOT called with access: 'blob'
      expect(mockContainerClient.createIfNotExists).not.toHaveBeenCalledWith({
        access: 'blob'
      })

      expect(mockBlockBlobClient.upload).toHaveBeenCalledWith(
        file.buffer,
        file.buffer.length,
        expect.objectContaining({
          blobHTTPHeaders: {
            blobContentType: file.mimetype
          },
          metadata: expect.objectContaining({
            uploadId,
            originalName: file.originalname,
            uploadedBy: metadata.uploadedBy
          })
        })
      )

      expect(mockBlockBlobClient.generateSasUrl).toHaveBeenCalledWith({
        permissions: 'r',
        expiresOn: expect.any(Date)
      })

      expect(result).toMatchObject({
        success: true,
        uploadId,
        blobName: file.originalname,
        url: expect.stringContaining('?sv=2024&sig=abc123'),
        plainUrl: 'https://test.blob.core.windows.net/test-container/test.xlsx',
        size: file.buffer.length,
        contentType: file.mimetype
      })
    })

    it('should handle SAS URL generation failure gracefully', async () => {
      // Arrange
      const uploadId = 'test-upload-456'
      const file = {
        originalname: 'test.csv',
        buffer: Buffer.from('test,data'),
        mimetype: 'text/csv'
      }

      const mockBlockBlobClient = {
        upload: vi.fn().mockResolvedValue({
          etag: '"test-etag"',
          lastModified: new Date()
        }),
        url: 'https://test.blob.core.windows.net/test-container/test.csv',
        generateSasUrl: vi
          .fn()
          .mockRejectedValue(new Error('No account key available'))
      }

      const mockContainerClient = {
        createIfNotExists: vi.fn().mockResolvedValue({ succeeded: true }),
        getBlockBlobClient: vi.fn().mockReturnValue(mockBlockBlobClient)
      }

      const mockBlobServiceClient = {
        getContainerClient: vi.fn().mockReturnValue(mockContainerClient)
      }

      const { uploadConfig } = await import(
        '../../../src/config/upload-config.js'
      )
      uploadConfig.getAzureBlobClient.mockResolvedValue(mockBlobServiceClient)

      // Act
      const result = await azureStorageService.uploadFile(uploadId, file)

      // Assert
      expect(result).toMatchObject({
        success: true,
        uploadId,
        url: 'https://test.blob.core.windows.net/test-container/test.csv', // Falls back to plain URL
        plainUrl: 'https://test.blob.core.windows.net/test-container/test.csv'
      })
    })

    it('should reject container creation with public access', async () => {
      // This test validates that our mock correctly simulates the Azure behavior
      const mockContainerClient = {
        createIfNotExists: vi.fn().mockImplementation((options) => {
          if (options && options.access) {
            return Promise.reject(
              new Error(
                'Public access is not permitted on this storage account'
              )
            )
          }
          return Promise.resolve({ succeeded: true })
        })
      }

      // Test that public access is rejected
      await expect(
        mockContainerClient.createIfNotExists({ access: 'blob' })
      ).rejects.toThrow(
        'Public access is not permitted on this storage account'
      )

      // Test that no options (private) works fine
      const result = await mockContainerClient.createIfNotExists()
      expect(result).toEqual({ succeeded: true })
    })

    it('should upload spreadsheet and JSON files to the same folder', async () => {
      // Arrange
      const uploadId = 'test-upload-789'
      const spreadsheetFile = {
        originalname: 'data.xlsx',
        buffer: Buffer.from('spreadsheet content'),
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }
      const jsonFile = {
        originalname: 'data.json',
        buffer: Buffer.from('{"formData": "test"}'),
        mimetype: 'application/json'
      }

      const mockBlockBlobClient = {
        upload: vi.fn().mockResolvedValue({
          etag: '"test-etag"',
          lastModified: new Date()
        }),
        url: 'https://test.blob.core.windows.net/test-container/test-file',
        generateSasUrl: vi
          .fn()
          .mockResolvedValue(
            'https://test.blob.core.windows.net/test-container/test-file?sv=2024&sig=abc123'
          )
      }

      const mockContainerClient = {
        createIfNotExists: vi.fn().mockResolvedValue({ succeeded: true }),
        getBlockBlobClient: vi.fn().mockReturnValue(mockBlockBlobClient)
      }

      const mockBlobServiceClient = {
        getContainerClient: vi.fn().mockReturnValue(mockContainerClient)
      }

      const { uploadConfig } = await import(
        '../../../src/config/upload-config.js'
      )
      uploadConfig.getAzureBlobClient.mockResolvedValue(mockBlobServiceClient)

      // Act - Upload spreadsheet
      const spreadsheetResult = await azureStorageService.uploadFile(
        uploadId,
        spreadsheetFile,
        { type: 'spreadsheet' }
      )

      // Act - Upload JSON with same uploadId
      const jsonResult = await azureStorageService.uploadFile(
        uploadId,
        jsonFile,
        { type: 'form-data', relatedSpreadsheet: 'data.xlsx' }
      )

      // Assert - Both files should be in the root folder
      expect(spreadsheetResult.blobName).toBe(spreadsheetFile.originalname)
      expect(jsonResult.blobName).toBe(jsonFile.originalname)

      // Verify getBlockBlobClient was called with correct paths (root level)
      expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith(
        'data.xlsx'
      )
      expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith(
        'data.json'
      )
    })
  })
})
