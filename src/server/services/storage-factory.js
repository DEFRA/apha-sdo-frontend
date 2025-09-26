import { config } from '../../config/config.js'
import { Readable } from 'node:stream'

/**
 * Factory for creating storage service instances with lazy loading and proper error handling
 */
class StorageServiceFactory {
  constructor(logger = console) {
    this.logger = logger
    this._azureService = null
  }

  /**
   * Get Azure Storage service instance with lazy loading
   * @returns {AzureStorageService|null} AzureStorageService instance or null if not configured
   */
  async getAzureService() {
    if (this._azureService === null) {
      try {
        const connectionString = config.get('storage.azure.connectionString')
        const isTestMode = config.get('isTest')

        // In test mode, provide mock service even if not configured
        if (
          isTestMode &&
          (!connectionString || connectionString.trim() === '')
        ) {
          this._azureService = this._createMockAzureService()
          this.logger.info('Using mock Azure Storage service in test mode')
          return this._azureService
        }

        if (!connectionString || connectionString.trim() === '') {
          this.logger.warn(
            'Azure Storage service not configured - missing connection string'
          )
          this._azureService = false // Mark as unavailable
          return null
        }

        // Only import and instantiate when actually configured
        const { AzureStorageService } = await import(
          '../upload/services/azure-storage-service.js'
        )
        this._azureService = new AzureStorageService()
        this.logger.info('Azure Storage service initialized successfully')
      } catch (error) {
        this.logger.error('Failed to initialize Azure Storage service', {
          error: error.message
        })

        // In test mode, fall back to mock service on error
        if (config.get('isTest')) {
          this._azureService = this._createMockAzureService()
          this.logger.info(
            'Using mock Azure Storage service due to initialization error'
          )
          return this._azureService
        }

        this._azureService = false // Mark as unavailable
        return null
      }
    }

    return this._azureService === false ? null : this._azureService
  }

  /**
   * Check if Azure Storage service is available
   * @returns {boolean} True if Azure Storage service is available
   */
  async isAzureAvailable() {
    return (await this.getAzureService()) !== null
  }

  /**
   * Create a mock Azure Storage service for testing
   */
  _createMockAzureService() {
    return {
      async uploadFile(blobName, buffer, contentType, metadata = {}) {
        return {
          blobName,
          etag: `"${Date.now()}"`,
          requestId: `mock-${Date.now()}`,
          url: `https://mock-storage.blob.core.windows.net/uploads/${blobName}`
        }
      },

      async downloadFile(blobName) {
        const mockStream = new Readable({
          read() {
            this.push('mock Azure file content')
            this.push(null)
          }
        })

        return {
          stream: mockStream,
          contentType: 'application/octet-stream',
          contentLength: 23,
          lastModified: new Date(),
          metadata: { originalName: blobName }
        }
      },

      async deleteFile(blobName) {
        return true
      },

      async listFiles(prefix = '') {
        return [
          {
            name: `${prefix}mock-file.txt`,
            size: 23,
            lastModified: new Date(),
            contentType: 'text/plain'
          }
        ]
      },

      async generateSasUrl(blobName, expiresIn = 3600) {
        return `https://mock-storage.blob.core.windows.net/uploads/${blobName}?mock-sas-token`
      }
    }
  }

  /**
   * Get list of available storage providers
   * @returns {string[]} Array of available provider names
   */
  async getAvailableProviders() {
    const providers = []
    if (await this.isAzureAvailable()) providers.push('azure')
    return providers
  }

  /**
   * Reset service instances (useful for testing)
   */
  reset() {
    this._azureService = null
  }
}

export { StorageServiceFactory }
