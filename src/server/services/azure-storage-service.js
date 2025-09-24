import {
  BlobServiceClient,
  StorageSharedKeyCredential
} from '@azure/storage-blob'
import { logger } from '../common/helpers/logging/logger.js'
import { config } from '../../config/config.js'

// Private state
const state = {
  config: null,
  blobServiceClient: null,
  initialized: false,
  retryOptions: {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2
  }
}

export async function initialize(azureConfig = null) {
  if (state.initialized) {
    return
  }

  try {
    state.config = azureConfig || config.get('azureStorage') || {}

    if (!state.config || typeof state.config !== 'object') {
      throw new Error('Azure Storage configuration is null or invalid')
    }

    const { connectionString, accountName, accountKey } = state.config

    if (connectionString) {
      state.blobServiceClient =
        BlobServiceClient.fromConnectionString(connectionString)
    } else if (accountName && accountKey) {
      const credential = new StorageSharedKeyCredential(accountName, accountKey)
      state.blobServiceClient = new BlobServiceClient(
        `https://${accountName}.blob.core.windows.net`,
        credential
      )
    } else {
      throw new Error(
        'Azure Storage credentials not configured. Please provide either connectionString or accountName/accountKey in configuration.'
      )
    }

    await checkConnectionHealth()
    state.initialized = true

    logger.info('Azure Blob Storage service initialized successfully', {
      accountName: state.config.accountName,
      serviceUrl: state.blobServiceClient.url
    })
  } catch (error) {
    logger.error('Failed to initialize Azure Blob Storage service', {
      error: error.message,
      stack: error.stack,
      configType: typeof state.config,
      configKeys: state.config ? Object.keys(state.config) : 'null'
    })

    state.config = null
    state.blobServiceClient = null
    state.initialized = false

    throw new Error(`Azure Storage initialization failed: ${error.message}`)
  }
}

export async function uploadFileToBlob(fileData, containerName, options = {}) {
  await ensureInitialized()

  const {
    blobName,
    metadata = {},
    contentType = 'application/octet-stream',
    accessTier = 'Hot',
    overwrite = false
  } = options

  if (!fileData || !containerName || !blobName) {
    throw new Error('fileData, containerName, and blobName are required')
  }

  const startTime = Date.now()
  const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`

  try {
    logger.info('Starting Azure blob upload', {
      uploadId,
      containerName,
      blobName,
      size: fileData.length || fileData.size,
      contentType,
      accessTier
    })

    const containerClient =
      state.blobServiceClient.getContainerClient(containerName)

    await ensureContainerExists(containerClient)

    const blobClient = containerClient.getBlobClient(blobName)
    const blockBlobClient = blobClient.getBlockBlobClient()

    // Check if blob exists and handle overwrite
    if (!overwrite) {
      const exists = await blobClient.exists()
      if (exists) {
        throw new Error(
          `Blob ${blobName} already exists and overwrite is disabled`
        )
      }
    }

    const uploadOptions = {
      blobHTTPHeaders: {
        blobContentType: contentType
      },
      metadata: {
        uploadId,
        uploadedAt: new Date().toISOString(),
        ...metadata
      },
      tier: accessTier
    }

    const uploadResult = await retryOperation(async () => {
      if (Buffer.isBuffer(fileData)) {
        return await blockBlobClient.upload(
          fileData,
          fileData.length,
          uploadOptions
        )
      } else if (fileData.stream) {
        return await blockBlobClient.uploadStream(
          fileData.stream,
          state.config.blob?.chunkSizeBytes || 4 * 1024 * 1024,
          undefined,
          uploadOptions
        )
      } else {
        throw new Error('Unsupported file data format')
      }
    })

    const duration = Date.now() - startTime

    logger.info('Azure blob upload completed successfully', {
      uploadId,
      containerName,
      blobName,
      duration,
      etag: uploadResult.etag,
      lastModified: uploadResult.lastModified
    })

    return {
      success: true,
      uploadId,
      blobUrl: blobClient.url,
      etag: uploadResult.etag,
      lastModified: uploadResult.lastModified,
      duration,
      metadata: uploadOptions.metadata
    }
  } catch (error) {
    const duration = Date.now() - startTime

    logger.error('Azure blob upload failed', {
      uploadId,
      containerName,
      blobName,
      duration,
      error: error.message,
      stack: error.stack
    })

    throw new Error(`Blob upload failed: ${error.message}`)
  }
}

export async function downloadFileFromBlob(
  containerName,
  blobName,
  options = {}
) {
  await ensureInitialized()

  const { asStream = false, range = null } = options

  const startTime = Date.now()
  const downloadId = `download-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`

  try {
    logger.info('Starting Azure blob download', {
      downloadId,
      containerName,
      blobName,
      asStream,
      range
    })

    const containerClient =
      state.blobServiceClient.getContainerClient(containerName)
    const blobClient = containerClient.getBlobClient(blobName)

    // Check if blob exists
    const exists = await blobClient.exists()
    if (!exists) {
      throw new Error(
        `Blob ${blobName} not found in container ${containerName}`
      )
    }

    // Get blob properties
    const properties = await blobClient.getProperties()

    // Download blob
    const downloadOptions = range ? { range } : {}
    const downloadResult = await retryOperation(async () => {
      return await blobClient.download(0, undefined, downloadOptions)
    })

    const duration = Date.now() - startTime

    if (asStream) {
      logger.info('Azure blob download stream ready', {
        downloadId,
        containerName,
        blobName,
        size: properties.contentLength,
        duration
      })

      return {
        success: true,
        downloadId,
        stream: downloadResult.readableStreamBody,
        properties: {
          contentLength: properties.contentLength,
          contentType: properties.contentType,
          lastModified: properties.lastModified,
          etag: properties.etag,
          metadata: properties.metadata
        },
        duration
      }
    } else {
      const buffer = await streamToBuffer(downloadResult.readableStreamBody)

      logger.info('Azure blob download completed successfully', {
        downloadId,
        containerName,
        blobName,
        size: buffer.length,
        duration
      })

      return {
        success: true,
        downloadId,
        buffer,
        properties: {
          contentLength: properties.contentLength,
          contentType: properties.contentType,
          lastModified: properties.lastModified,
          etag: properties.etag,
          metadata: properties.metadata
        },
        duration
      }
    }
  } catch (error) {
    const duration = Date.now() - startTime

    logger.error('Azure blob download failed', {
      downloadId,
      containerName,
      blobName,
      duration,
      error: error.message,
      stack: error.stack
    })

    throw new Error(`Blob download failed: ${error.message}`)
  }
}

export async function deleteFileFromBlob(containerName, blobName) {
  await ensureInitialized()

  const startTime = Date.now()
  const deleteId = `delete-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`

  try {
    logger.info('Starting Azure blob deletion', {
      deleteId,
      containerName,
      blobName
    })

    const containerClient =
      state.blobServiceClient.getContainerClient(containerName)
    const blobClient = containerClient.getBlobClient(blobName)

    // Check if blob exists
    const exists = await blobClient.exists()
    if (!exists) {
      logger.warn('Blob not found for deletion', {
        deleteId,
        containerName,
        blobName
      })
      return {
        success: true,
        deleteId,
        found: false,
        message: 'Blob not found (already deleted or never existed)'
      }
    }

    // Delete blob
    await retryOperation(async () => {
      return await blobClient.delete()
    })

    const duration = Date.now() - startTime

    logger.info('Azure blob deletion completed successfully', {
      deleteId,
      containerName,
      blobName,
      duration
    })

    return {
      success: true,
      deleteId,
      found: true,
      duration,
      deletedAt: new Date().toISOString()
    }
  } catch (error) {
    const duration = Date.now() - startTime

    logger.error('Azure blob deletion failed', {
      deleteId,
      containerName,
      blobName,
      duration,
      error: error.message,
      stack: error.stack
    })

    throw new Error(`Blob deletion failed: ${error.message}`)
  }
}

export async function getBlobMetadata(containerName, blobName) {
  await ensureInitialized()

  try {
    const containerClient =
      state.blobServiceClient.getContainerClient(containerName)
    const blobClient = containerClient.getBlobClient(blobName)

    const properties = await blobClient.getProperties()

    return {
      exists: true,
      contentLength: properties.contentLength,
      contentType: properties.contentType,
      lastModified: properties.lastModified,
      etag: properties.etag,
      metadata: properties.metadata || {},
      accessTier: properties.accessTier,
      blobType: properties.blobType,
      url: blobClient.url
    }
  } catch (error) {
    if (error.statusCode === 404) {
      return { exists: false }
    }
    throw new Error(`Failed to get blob metadata: ${error.message}`)
  }
}

export async function checkConnectionHealth() {
  const startTime = Date.now()

  try {
    if (!state.blobServiceClient) {
      throw new Error('Blob service client not initialized')
    }

    await state.blobServiceClient.getProperties()

    const duration = Date.now() - startTime

    return {
      healthy: true,
      responseTime: duration,
      timestamp: new Date().toISOString(),
      serviceUrl: state.blobServiceClient.url
    }
  } catch (error) {
    const duration = Date.now() - startTime

    return {
      healthy: false,
      responseTime: duration,
      timestamp: new Date().toISOString(),
      error: error.message
    }
  }
}

export async function uploadFileFromStream(
  stream,
  containerName,
  options = {}
) {
  await ensureInitialized()

  const {
    blobName,
    metadata = {},
    contentType = 'application/octet-stream',
    accessTier = 'Hot'
  } = options

  if (!stream || !containerName || !blobName) {
    throw new Error('stream, containerName, and blobName are required')
  }

  const startTime = Date.now()
  const uploadId = `stream-upload-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`

  try {
    logger.info('Starting Azure blob upload from stream', {
      uploadId,
      containerName,
      blobName,
      contentType,
      accessTier
    })

    const containerClient =
      state.blobServiceClient.getContainerClient(containerName)

    await ensureContainerExists(containerClient)

    const blobClient = containerClient.getBlobClient(blobName)
    const blockBlobClient = blobClient.getBlockBlobClient()

    const uploadOptions = {
      blobHTTPHeaders: {
        blobContentType: contentType
      },
      metadata: {
        uploadId,
        uploadedAt: new Date().toISOString(),
        ...metadata
      },
      tier: accessTier
    }

    const uploadResult = await retryOperation(async () => {
      return await blockBlobClient.uploadStream(
        stream,
        state.config.blockSize || 4 * 1024 * 1024,
        undefined,
        uploadOptions
      )
    })

    const duration = Date.now() - startTime

    logger.info('Azure blob upload from stream completed successfully', {
      uploadId,
      containerName,
      blobName,
      duration,
      etag: uploadResult.etag,
      lastModified: uploadResult.lastModified
    })

    return {
      success: true,
      uploadId,
      url: blobClient.url,
      etag: uploadResult.etag,
      lastModified: uploadResult.lastModified,
      duration,
      metadata: uploadOptions.metadata
    }
  } catch (error) {
    const duration = Date.now() - startTime

    logger.error('Azure blob upload from stream failed', {
      uploadId,
      containerName,
      blobName,
      duration,
      error: error.message,
      stack: error.stack
    })

    throw new Error(`Stream upload failed: ${error.message}`)
  }
}

export async function uploadMetadata(metadataBlobName, metadata) {
  await ensureInitialized()

  if (!metadataBlobName || !metadata) {
    throw new Error('metadataBlobName and metadata are required')
  }

  const startTime = Date.now()
  const uploadId = `metadata-upload-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`

  try {
    logger.info('Starting metadata upload to Azure', {
      uploadId,
      metadataBlobName,
      metadataKeys: Object.keys(metadata)
    })

    const jsonBuffer = Buffer.from(JSON.stringify(metadata, null, 2), 'utf8')

    const containerName = state.config.containerName || 'apha-sdo-files'

    const uploadResult = await uploadFileToBlob(jsonBuffer, containerName, {
      blobName: metadataBlobName,
      contentType: 'application/json',
      metadata: {
        uploadId,
        fileType: 'metadata',
        uploadedAt: new Date().toISOString()
      }
    })

    const duration = Date.now() - startTime

    logger.info('Metadata upload completed successfully', {
      uploadId,
      metadataBlobName,
      size: jsonBuffer.length,
      duration
    })

    return {
      success: true,
      metadataUrl: uploadResult.blobUrl,
      size: jsonBuffer.length,
      duration
    }
  } catch (error) {
    const duration = Date.now() - startTime

    logger.error('Metadata upload failed', {
      uploadId,
      metadataBlobName,
      duration,
      error: error.message
    })

    throw new Error(`Metadata upload failed: ${error.message}`)
  }
}

export async function deleteFile(blobName, containerName = null) {
  const container =
    containerName || state.config.containerName || 'apha-sdo-files'
  return await deleteFileFromBlob(container, blobName)
}

export async function getFileUrl(blobName, containerName = null) {
  await ensureInitialized()

  const container =
    containerName || state.config.containerName || 'apha-sdo-files'
  const containerClient = state.blobServiceClient.getContainerClient(container)
  const blobClient = containerClient.getBlobClient(blobName)

  return blobClient.url
}

export async function getStorageMetrics() {
  await ensureInitialized()

  try {
    const health = await checkConnectionHealth()

    return {
      service: {
        initialized: state.initialized,
        healthy: health.healthy,
        responseTime: health.responseTime
      },
      configuration: {
        accountName: state.config.accountName,
        defaultContainer: state.config.containerName,
        retryAttempts: state.retryOptions.maxAttempts,
        chunkSize: state.config.blockSize || 4194304
      },
      timestamp: new Date().toISOString()
    }
  } catch (error) {
    logger.error('Failed to get storage metrics', { error: error.message })
    return {
      error: error.message,
      timestamp: new Date().toISOString()
    }
  }
}

async function ensureInitialized() {
  if (!state.initialized) {
    await initialize()
  }
}

async function ensureContainerExists(containerClient) {
  try {
    const exists = await containerClient.exists()
    if (!exists) {
      logger.info('Creating container', {
        containerName: containerClient.containerName
      })
      await containerClient.create()
    }
  } catch (error) {
    if (error.statusCode !== 409) {
      throw error
    }
  }
}

async function retryOperation(operation) {
  let lastError
  let delay = state.retryOptions.baseDelayMs

  for (let attempt = 1; attempt <= state.retryOptions.maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error

      if (attempt === state.retryOptions.maxAttempts) {
        break
      }

      if (!isRetryableError(error)) {
        break
      }

      logger.warn(
        `Azure operation failed, retrying (attempt ${attempt}/${state.retryOptions.maxAttempts})`,
        {
          error: error.message,
          nextRetryDelay: delay
        }
      )

      await sleep(delay)
      delay = Math.min(
        delay * state.retryOptions.backoffMultiplier,
        state.retryOptions.maxDelayMs
      )
    }
  }

  throw lastError
}

function isRetryableError(error) {
  const retryableStatusCodes = [429, 500, 502, 503, 504]
  const retryableErrorCodes = ['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT']

  return (
    retryableStatusCodes.includes(error.statusCode) ||
    retryableErrorCodes.includes(error.code) ||
    error.message.includes('timeout') ||
    error.message.includes('network')
  )
}

async function streamToBuffer(stream) {
  const chunks = []
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default {
  initialize,
  uploadFileToBlob,
  uploadFileFromStream,
  uploadMetadata,
  downloadFileFromBlob,
  deleteFileFromBlob,
  deleteFile,
  getFileUrl,
  getBlobMetadata,
  checkConnectionHealth,
  getStorageMetrics
}
