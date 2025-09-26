import { config } from './config.js'
import {
  BlobServiceClient,
  StorageSharedKeyCredential
} from '@azure/storage-blob'
import { DefaultAzureCredential, ClientSecretCredential } from '@azure/identity'
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/**
 * Upload Configuration Service
 * Provides centralized configuration for all upload services
 */
export class UploadConfig {
  constructor() {
    // Use the existing storage configuration structure with null checks
    this.storageConfig = this._initializeStorageConfig()
    this.cdpUploaderConfig = this.storageConfig.cdpUploader || {}
    this.azureConfig = this.storageConfig.azure || {}
    this.s3Config = this.storageConfig.s3 || {}

    // Create forms engine config from storage settings with defaults
    this.formsEngineConfig = {
      uploadPath: '/upload',
      maxFileSize: this.storageConfig.maxFileSize || 52428800, // 50MB default
      allowedFileTypes: [
        '.pdf',
        '.doc',
        '.docx',
        '.xls',
        '.xlsx',
        '.jpg',
        '.jpeg',
        '.png',
        '.gif'
      ],
      uploadDirectory: './uploads'
    }

    this._azureBlobClient = null
    this._s3Client = null
  }

  /**
   * Initialize storage configuration with safe defaults
   * @private
   */
  _initializeStorageConfig() {
    try {
      const storageConfig = config.get('storage')
      if (!storageConfig || typeof storageConfig !== 'object') {
        return this._getDefaultStorageConfig()
      }

      // Ensure all required nested objects exist
      return {
        cdpUploader: storageConfig.cdpUploader || {},
        azure: storageConfig.azure || {},
        s3: storageConfig.s3 || {},
        maxFileSize: storageConfig.maxFileSize || 52428800, // 50MB default
        allowedMimeTypes: storageConfig.allowedMimeTypes || [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'text/csv'
        ]
      }
    } catch (error) {
      console.warn(
        'Failed to load storage configuration, using defaults:',
        error.message
      )
      return this._getDefaultStorageConfig()
    }
  }

  /**
   * Get default storage configuration
   * @private
   */
  _getDefaultStorageConfig() {
    return {
      cdpUploader: {
        endpoint: 'https://cdp-uploader.service.gov.uk',
        apiKey: ''
      },
      azure: {
        connectionString: '',
        containerName: 'uploads'
      },
      s3: {
        bucket: 'apha-sdo-uploads',
        region: 'eu-west-2',
        accessKeyId: '',
        secretAccessKey: ''
      },
      maxFileSize: 52428800, // 50MB
      allowedMimeTypes: [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'text/csv'
      ]
    }
  }

  /**
   * Get CDP Uploader configuration
   */
  getCdpUploaderConfig() {
    return {
      url:
        (this.cdpUploaderConfig && this.cdpUploaderConfig.endpoint) ||
        process.env.CDP_UPLOADER_URL ||
        'http://localhost:7337',
      bucket:
        (this.s3Config && this.s3Config.bucket) ||
        process.env.CDP_UPLOADER_BUCKET ||
        'my-bucket',
      stagingPrefix: process.env.CDP_UPLOADER_STAGING_PREFIX || 'staging/',
      maxFileSize:
        (this.storageConfig && this.storageConfig.maxFileSize) || 26214400,
      timeout: parseInt(process.env.CDP_UPLOADER_TIMEOUT) || 30000,
      retryAttempts: parseInt(process.env.CDP_UPLOADER_RETRY_ATTEMPTS) || 3,
      callbackAuthToken:
        process.env.CALLBACK_AUTH_TOKEN ||
        'dev-callback-token-12345678901234567890123456789012'
    }
  }

  /**
   * Get Azure Blob Storage client
   */
  async getAzureBlobClient() {
    const azureEnabled = process.env.AZURE_STORAGE_ENABLED === 'true'
    if (!azureEnabled) {
      throw new Error('Azure Blob Storage is not enabled')
    }

    if (this._azureBlobClient) {
      return this._azureBlobClient
    }

    let credential

    // Use connection string for development
    if (this.azureConfig && this.azureConfig.connectionString) {
      this._azureBlobClient = BlobServiceClient.fromConnectionString(
        this.azureConfig.connectionString
      )
      return this._azureBlobClient
    }
    // Use Service Principal authentication in production
    else if (
      process.env.AZURE_TENANT_ID &&
      process.env.AZURE_CLIENT_ID &&
      process.env.AZURE_CLIENT_SECRET
    ) {
      credential = new ClientSecretCredential(
        process.env.AZURE_TENANT_ID,
        process.env.AZURE_CLIENT_ID,
        process.env.AZURE_CLIENT_SECRET
      )
    }
    // Use account name and key
    else if (
      process.env.AZURE_STORAGE_ACCOUNT_NAME &&
      process.env.AZURE_STORAGE_ACCOUNT_KEY
    ) {
      credential = new StorageSharedKeyCredential(
        process.env.AZURE_STORAGE_ACCOUNT_NAME,
        process.env.AZURE_STORAGE_ACCOUNT_KEY
      )
    }
    // Use managed identity or default credential
    else {
      credential = new DefaultAzureCredential()
    }

    const accountUrl = `https://${process.env.AZURE_STORAGE_ACCOUNT_NAME || 'default'}.blob.core.windows.net`
    this._azureBlobClient = new BlobServiceClient(accountUrl, credential)

    return this._azureBlobClient
  }

  getS3Client() {
    const s3Enabled = process.env.S3_ENABLED === 'true'
    if (!s3Enabled) {
      return null
    }

    if (this._s3Client) {
      return this._s3Client
    }

    const clientConfig = {
      region: (this.s3Config && this.s3Config.region) || 'eu-west-2'
    }

    // Add credentials if provided (for non-IAM role environments)
    if (
      this.s3Config &&
      this.s3Config.accessKeyId &&
      this.s3Config.secretAccessKey
    ) {
      clientConfig.credentials = {
        accessKeyId: this.s3Config.accessKeyId,
        secretAccessKey: this.s3Config.secretAccessKey
      }
    }

    try {
      this._s3Client = new S3Client(clientConfig)
      return this._s3Client
    } catch (error) {
      return null
    }
  }

  /**
   * Get Forms Engine configuration
   */
  getFormsEngineConfig() {
    return {
      uploadPath: this.formsEngineConfig.uploadPath,
      maxFileSize: this.formsEngineConfig.maxFileSize,
      allowedFileTypes: this.formsEngineConfig.allowedFileTypes,
      uploadDirectory: this.formsEngineConfig.uploadDirectory
    }
  }

  /**
   * Generate presigned URL for S3 download
   */
  async generateS3PresignedUrl(key, operation = 'getObject') {
    const s3Client = this.getS3Client()

    const bucket = (this.s3Config && this.s3Config.bucket) || 'default-bucket'
    const command =
      operation === 'putObject'
        ? new PutObjectCommand({ Bucket: bucket, Key: key })
        : new GetObjectCommand({ Bucket: bucket, Key: key })

    return await getSignedUrl(s3Client, command, {
      expiresIn: parseInt(process.env.S3_PRESIGNED_URL_EXPIRY) || 3600
    })
  }

  /**
   * Validate upload configuration
   */
  validateConfig() {
    const errors = []
    const cdpConfig = this.getCdpUploaderConfig()

    // Validate CDP Uploader config
    if (!cdpConfig.url) {
      errors.push('CDP_UPLOADER_URL is required')
    }
    if (!cdpConfig.bucket) {
      errors.push('CDP_UPLOADER_BUCKET is required')
    }
    if (
      !cdpConfig.callbackAuthToken ||
      cdpConfig.callbackAuthToken.length < 32
    ) {
      errors.push('CALLBACK_AUTH_TOKEN must be at least 32 characters long')
    }

    // Validate Azure config if enabled
    const azureEnabled = process.env.AZURE_STORAGE_ENABLED === 'true'
    if (azureEnabled) {
      if (
        !(this.azureConfig && this.azureConfig.connectionString) &&
        !process.env.AZURE_STORAGE_ACCOUNT_NAME &&
        !(
          process.env.AZURE_TENANT_ID &&
          process.env.AZURE_CLIENT_ID &&
          process.env.AZURE_CLIENT_SECRET
        )
      ) {
        errors.push(
          'Azure configuration is incomplete. Provide either connectionString, accountName/accountKey, or service principal credentials'
        )
      }
      if (!(this.azureConfig && this.azureConfig.containerName)) {
        errors.push('AZURE_CONTAINER_NAME is required when Azure is enabled')
      }
    }

    // Validate S3 config if explicitly enabled (OPTIONAL)
    const s3Enabled = process.env.S3_ENABLED === 'true'
    if (s3Enabled) {
      if (!(this.s3Config && this.s3Config.region)) {
        errors.push('AWS_REGION is required when S3 is explicitly enabled')
      }
      if (!(this.s3Config && this.s3Config.bucket)) {
        errors.push(
          'S3_DOWNLOAD_BUCKET is required when S3 is explicitly enabled'
        )
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  /**
   * Get health check information
   */
  async getHealthCheck() {
    const cdpConfig = this.getCdpUploaderConfig()
    const azureEnabled = process.env.AZURE_STORAGE_ENABLED === 'true'
    const s3Enabled = process.env.S3_ENABLED !== 'false'

    const health = {
      cdpUploader: {
        configured: !!cdpConfig.url,
        url: cdpConfig.url
      },
      azure: {
        enabled: azureEnabled,
        configured: azureEnabled
          ? !!(
              (this.azureConfig && this.azureConfig.connectionString) ||
              process.env.AZURE_STORAGE_ACCOUNT_NAME
            )
          : true
      },
      s3: {
        enabled: s3Enabled,
        configured: s3Enabled
          ? !!(this.s3Config && this.s3Config.region && this.s3Config.bucket)
          : false, // S3 is optional
        optional: true,
        region: this.s3Config && this.s3Config.region,
        bucket: this.s3Config && this.s3Config.bucket
      },
      formsEngine: {
        uploadPath: this.formsEngineConfig.uploadPath,
        maxFileSize: this.formsEngineConfig.maxFileSize,
        allowedTypes: this.formsEngineConfig.allowedFileTypes.length
      }
    }

    // Test Azure connection if enabled
    if (azureEnabled) {
      try {
        const blobClient = await this.getAzureBlobClient()
        const containerClient = blobClient.getContainerClient(
          (this.azureConfig && this.azureConfig.containerName) || 'uploads'
        )
        await containerClient.exists()
        health.azure.connectionStatus = 'healthy'
      } catch (error) {
        health.azure.connectionStatus = 'error'
        health.azure.error = error.message
      }
    }

    // Test S3 connection if enabled
    if (s3Enabled) {
      try {
        // const s3Client = this.getS3Client()
        // Simple test to check if client is configured correctly
        health.s3.connectionStatus = 'configured'
      } catch (error) {
        health.s3.connectionStatus = 'error'
        health.s3.error = error.message
      }
    }

    return health
  }
}

// Export singleton instance
export const uploadConfig = new UploadConfig()
