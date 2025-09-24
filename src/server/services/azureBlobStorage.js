import {
  BlobServiceClient,
  StorageSharedKeyCredential
} from '@azure/storage-blob'
import { ClientSecretCredential } from '@azure/identity'
import { createReadStream, promises as fs } from 'fs'
import { logger } from '../common/helpers/logging/logger.js'
import azureConfig from './azureConfig.js'

const state = {
  blobServiceClient: null,
  isInitialized: false,
  metrics: {
    uploadsStarted: 0,
    uploadsCompleted: 0,
    uploadsFailed: 0,
    downloadsStarted: 0,
    downloadsCompleted: 0,
    downloadsFailed: 0,
    deletionsStarted: 0,
    deletionsCompleted: 0,
    deletionsFailed: 0,
    totalBytesUploaded: 0,
    totalBytesDownloaded: 0,
    averageUploadTime: 0,
    lastOperationTime: null
  },
  uploadTimes: []
}

async function initialize() {
  try {
    const configResult = await azureConfig.initialize()

    if (!configResult.success) {
      throw new Error('Azure configuration initialization failed')
    }

    const connectionType = azureConfig.getConnectionType()

    switch (connectionType) {
      case 'connectionString':
        state.blobServiceClient = BlobServiceClient.fromConnectionString(
          azureConfig.get('connectionString')
        )
        break

      case 'accountKey': {
        const sharedKeyCredential = new StorageSharedKeyCredential(
          azureConfig.get('accountName'),
          azureConfig.get('accountKey')
        )
        state.blobServiceClient = new BlobServiceClient(
          `https://${azureConfig.get('accountName')}.blob.core.windows.net`,
          sharedKeyCredential
        )
        break
      }

      case 'sasToken':
        state.blobServiceClient = new BlobServiceClient(
          `https://${azureConfig.get('accountName')}.blob.core.windows.net${azureConfig.get('sasToken')}`
        )
        break

      case 'servicePrincipal': {
        const servicePrincipalCredential = new ClientSecretCredential(
          azureConfig.get('tenantId'),
          azureConfig.get('clientId'),
          azureConfig.get('clientSecret')
        )
        state.blobServiceClient = new BlobServiceClient(
          `https://${azureConfig.get('accountName')}.blob.core.windows.net`,
          servicePrincipalCredential
        )
        break
      }

      default:
        throw new Error(`Unsupported connection type: ${connectionType}`)
    }

    await testConnection()

    await ensureContainersExist()

    state.isInitialized = true

    logger.info('Azure Blob Storage service initialized successfully', {
      connectionType,
      accountName: azureConfig.get('accountName'),
      containerName: azureConfig.getContainerName()
    })
  } catch (error) {
    state.isInitialized = false
    logger.error('Azure Blob Storage initialization failed', {
      error: error.message,
      stack: error.stack
    })
    throw error
  }
}

async function uploadFile(filePath, containerName, blobName, options = {}) {
  ensureInitialized()

  const startTime = Date.now()
  state.metrics.uploadsStarted++

  try {
    const stats = await fs.stat(filePath)
    const fileSize = stats.size

    const containerClient =
      state.blobServiceClient.getContainerClient(containerName)
    const blockBlobClient = containerClient.getBlockBlobClient(blobName)
    const uploadOptions = {
      blobHTTPHeaders: {
        blobContentType: options.contentType || getContentType(filePath),
        blobCacheControl: options.cacheControl || 'no-cache',
        blobContentDisposition:
          options.contentDisposition || `attachment; filename="${blobName}"`
      },
      metadata: {
        originalName: options.originalName || blobName,
        uploadedBy: 'apha-sdo-frontend',
        uploadTime: new Date().toISOString(),
        fileSize: fileSize.toString(),
        ...options.metadata
      },
      tags: {
        source: 'apha-sdo-frontend',
        environment: process.env.NODE_ENV || 'development',
        ...options.tags
      },
      onProgress: options.onProgress || createProgressHandler(blobName),
      blockSize: azureConfig.get('blockSize'),
      concurrency: azureConfig.get('maxConcurrency'),
      ...getRetryOptions()
    }

    const readStream = createReadStream(filePath)
    const uploadResponse = await blockBlobClient.uploadStream(
      readStream,
      fileSize,
      undefined,
      uploadOptions
    )

    const uploadTime = Date.now() - startTime
    updateUploadMetrics(fileSize, uploadTime)

    const result = {
      success: true,
      blobName,
      containerName,
      url: blockBlobClient.url,
      etag: uploadResponse.etag,
      lastModified: uploadResponse.lastModified,
      contentMD5: uploadResponse.contentMD5,
      fileSize,
      uploadTime,
      requestId: uploadResponse.requestId
    }

    logger.info('File uploaded to Azure Blob Storage', {
      blobName,
      containerName,
      fileSize,
      uploadTime,
      url: result.url
    })

    return result
  } catch (error) {
    state.metrics.uploadsFailed++
    logger.error('File upload to Azure failed', {
      filePath,
      blobName,
      containerName,
      error: error.message,
      stack: error.stack
    })
    throw new Error(`Azure upload failed: ${error.message}`)
  }
}

function getMetrics() {
  return {
    ...state.metrics,
    isInitialized: state.isInitialized,
    configuration: azureConfig.getHealthStatus(),
    timestamp: new Date().toISOString()
  }
}

async function getHealthStatus() {
  const health = {
    status: 'healthy',
    initialized: state.isInitialized,
    configuration: azureConfig.getHealthStatus(),
    metrics: getMetrics(),
    timestamp: new Date().toISOString()
  }

  if (!state.isInitialized) {
    health.status = 'unhealthy'
    health.error = 'Service not initialized'
    return health
  }

  try {
    await testConnection()
    health.connectionTest = 'passed'
  } catch (error) {
    health.status = 'degraded'
    health.connectionTest = 'failed'
    health.connectionError = error.message
  }

  return health
}

function ensureInitialized() {
  if (!state.isInitialized) {
    throw new Error(
      'Azure Blob Storage service not initialized. Call initialize() first.'
    )
  }
}

async function testConnection() {
  try {
    const iterator = state.blobServiceClient.listContainers()
    await iterator.next()
    logger.debug('Azure Storage connection test successful')
  } catch (error) {
    logger.error('Azure Storage connection test failed', {
      error: error.message
    })
    throw new Error(`Azure Storage connection failed: ${error.message}`)
  }
}

async function ensureContainersExist() {
  const containers = [
    azureConfig.getContainerName(),
    azureConfig.getStagingContainer(),
    azureConfig.getArchiveContainer()
  ]

  for (const containerName of containers) {
    try {
      const containerClient =
        state.blobServiceClient.getContainerClient(containerName)
      await containerClient.createIfNotExists({
        access: 'private',
        metadata: {
          createdBy: 'apha-sdo-frontend',
          purpose: 'file-uploads',
          environment: process.env.NODE_ENV || 'development'
        }
      })

      logger.debug('Container ensured', { containerName })
    } catch (error) {
      logger.warn('Failed to ensure container exists', {
        containerName,
        error: error.message
      })
    }
  }
}

function getRetryOptions() {
  const retryConfig = azureConfig.getRetryConfig()
  return {
    maxRetryDelayInMs: retryConfig.maxRetryDelayMs,
    retryDelayInMs: retryConfig.retryDelayMs,
    maxTries: retryConfig.maxRetries + 1
  }
}

const MIME_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  zip: 'application/zip'
}

function getContentType(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase()
  return MIME_TYPES[ext] || 'application/octet-stream'
}

function createProgressHandler(blobName) {
  if (!azureConfig.get('enableProgressTracking')) {
    return null
  }

  return (progress) => {
    const percentage = (
      (progress.loadedBytes / progress.totalBytes) *
      100
    ).toFixed(2)
    logger.debug('Upload progress', {
      blobName,
      percentage: `${percentage}%`,
      loadedBytes: progress.loadedBytes,
      totalBytes: progress.totalBytes
    })
  }
}

function updateUploadMetrics(fileSize, uploadTime) {
  state.metrics.uploadsCompleted++
  state.metrics.totalBytesUploaded += fileSize
  state.metrics.lastOperationTime = new Date().toISOString()

  state.uploadTimes.push(uploadTime)
  if (state.uploadTimes.length > 100) {
    state.uploadTimes.shift()
  }
  state.metrics.averageUploadTime =
    state.uploadTimes.reduce((a, b) => a + b, 0) / state.uploadTimes.length
}

function reset() {
  state.blobServiceClient = null
  state.isInitialized = false
  state.metrics = {
    uploadsStarted: 0,
    uploadsCompleted: 0,
    uploadsFailed: 0,
    downloadsStarted: 0,
    downloadsCompleted: 0,
    downloadsFailed: 0,
    deletionsStarted: 0,
    deletionsCompleted: 0,
    deletionsFailed: 0,
    totalBytesUploaded: 0,
    totalBytesDownloaded: 0,
    averageUploadTime: 0,
    lastOperationTime: null
  }
  state.uploadTimes = []
}

export default {
  initialize,
  uploadFile,
  getMetrics,
  getHealthStatus,
  reset
}

export { initialize, uploadFile, getMetrics, getHealthStatus, reset }
