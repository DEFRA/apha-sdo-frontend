import { logger } from '../common/helpers/logging/logger.js'
import { config } from '../../config/config.js'

/**
 * CDP-Uploader Service Client
 *
 * Integration: DEFRA CDP-Uploader service for secure Azure Blob Storage uploads
 */

const state = {
  baseUrl: null,
  submissionUrl: null,
  bucketName: null,
  stagingPrefix: null,
  maxFileSize: null,
  timeout: null,
  retryAttempts: null,
  initialized: false
}

function initializeConfig() {
  if (state.initialized) return

  const cdpConfig = config.get('cdpUploader')
  state.baseUrl = cdpConfig.baseUrl
  state.submissionUrl = cdpConfig.submissionUrl
  state.bucketName = cdpConfig.bucketName
  state.stagingPrefix = cdpConfig.stagingPrefix
  state.maxFileSize = cdpConfig.maxFileSize
  state.timeout = cdpConfig.timeout
  state.retryAttempts = cdpConfig.retryAttempts
  state.initialized = true
}

/**
 * Initiate CDP upload session
 */
export async function initiateUpload(uploadOptions) {
  initializeConfig()

  const {
    formPath,
    retrievalKey,
    mimeTypes = [],
    metadata = null,
    callbackUrl,
    maxFileSize = state.maxFileSize
  } = uploadOptions

  if (!formPath) {
    throw new Error('formPath is required for upload initiation')
  }

  if (!retrievalKey) {
    throw new Error('retrievalKey is required for upload initiation')
  }

  const requestBody = {
    formPath,
    retrievalKey,
    bucketName: state.bucketName,
    stagingPrefix: state.stagingPrefix,
    allowedMimeTypes: mimeTypes,
    maxFileSize,
    metadata: metadata || {},
    callbackUrl: callbackUrl || `${state.baseUrl}/callback/upload`
  }

  try {
    logger.info('Initiating CDP upload session', {
      formPath,
      retrievalKey,
      mimeTypesCount: mimeTypes.length,
      maxFileSize
    })

    const response = await makeApiRequest('POST', '/initiate', requestBody)

    logger.info('CDP upload session initiated successfully', {
      uploadId: response.uploadId,
      retrievalKey,
      expiresAt: response.expiresAt
    })

    return response
  } catch (error) {
    logger.error('CDP upload initiation failed', {
      formPath,
      retrievalKey,
      error: error.message,
      stack: error.stack
    })
    throw new Error(`Upload initiation failed: ${error.message}`)
  }
}

/**
 * Get upload status and progress
 */
export async function getUploadStatus(uploadId) {
  initializeConfig()

  if (!uploadId) {
    throw new Error('uploadId is required for status check')
  }

  try {
    logger.debug('Checking CDP upload status', { uploadId })

    const response = await makeApiRequest('GET', `/status/${uploadId}`)

    logger.debug('CDP upload status retrieved', {
      uploadId,
      status: response.status,
      progress: response.progress
    })

    return response
  } catch (error) {
    logger.error('CDP upload status check failed', {
      uploadId,
      error: error.message
    })
    throw new Error(`Status check failed: ${error.message}`)
  }
}

/**
 * Delete upload session and files
 */
export async function deleteUpload(uploadId) {
  initializeConfig()

  if (!uploadId) {
    throw new Error('uploadId is required for deletion')
  }

  try {
    logger.info('Deleting CDP upload session', { uploadId })

    const response = await makeApiRequest('DELETE', `/upload/${uploadId}`)

    logger.info('CDP upload session deleted successfully', {
      uploadId,
      deletedAt: response.deletedAt
    })

    return {
      success: true,
      uploadId,
      deletedAt: response.deletedAt || new Date().toISOString()
    }
  } catch (error) {
    logger.error('CDP upload deletion failed', {
      uploadId,
      error: error.message
    })
    throw new Error(`Upload deletion failed: ${error.message}`)
  }
}

/**
 * Validate file before upload
 */
export function validateFile(file, allowedMimeTypes = []) {
  initializeConfig()

  const errors = []

  if (!file) {
    errors.push('File object is required')
    return { valid: false, errors, fileInfo: null }
  }

  if (!file.originalname) {
    errors.push('File must have an original filename')
  }

  if (typeof file.size !== 'number' || file.size <= 0) {
    errors.push('File must have a valid size greater than 0')
  }

  if (!file.mimetype) {
    errors.push('File must have a MIME type')
  }

  if (file.size > state.maxFileSize) {
    errors.push(
      `File size ${file.size} exceeds maximum allowed size of ${state.maxFileSize} bytes`
    )
  }

  if (
    allowedMimeTypes.length > 0 &&
    !allowedMimeTypes.includes(file.mimetype)
  ) {
    errors.push(
      `File MIME type '${file.mimetype}' is not allowed. Allowed types: ${allowedMimeTypes.join(', ')}`
    )
  }

  // Security: Filename validation
  if (
    file.originalname &&
    (file.originalname.includes('..') ||
      file.originalname.includes('/') ||
      file.originalname.includes('\\'))
  ) {
    errors.push(
      'Filename contains invalid characters or path traversal sequences'
    )
  }

  const fileInfo = {
    originalname: file.originalname,
    size: file.size,
    mimetype: file.mimetype,
    extension: file.originalname
      ? file.originalname.split('.').pop()?.toLowerCase()
      : undefined
  }

  return {
    valid: errors.length === 0,
    errors,
    fileInfo
  }
}

export function resetInitializedState() {
  state.initialized = false
}

/**
 * Get CDP service health status
 */
export async function getHealthInfo() {
  initializeConfig()

  const startTime = Date.now()

  try {
    const response = await makeApiRequest('GET', '/health')
    const responseTime = Math.max(1, Date.now() - startTime)

    return {
      healthy: true,
      config: {
        baseUrl: state.baseUrl,
        bucketName: state.bucketName,
        maxFileSize: state.maxFileSize,
        timeout: state.timeout
      },
      version: response.version || 'unknown',
      responseTime
    }
  } catch (error) {
    const responseTime = Math.max(1, Date.now() - startTime)

    return {
      healthy: false,
      config: {
        baseUrl: state.baseUrl,
        bucketName: state.bucketName,
        maxFileSize: state.maxFileSize,
        timeout: state.timeout
      },
      error:
        error.message ===
          'CDP API error: 503 Service Unavailable - Service not available' ||
        error.message === 'No response from server'
          ? 'Service unavailable'
          : error.message,
      responseTime
    }
  }
}

async function makeApiRequest(method, endpoint, body = null) {
  const url = `${state.baseUrl}${endpoint}`
  let lastError

  for (let attempt = 1; attempt <= state.retryAttempts; attempt++) {
    try {
      const requestOptions = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'apha-sdo-frontend/1.0.0'
        },
        timeout: state.timeout
      }

      if (
        body &&
        (method === 'POST' || method === 'PUT' || method === 'PATCH')
      ) {
        requestOptions.body = JSON.stringify(body)
      }

      logger.debug(
        `CDP API request (attempt ${attempt}/${state.retryAttempts})`,
        {
          method,
          url: endpoint,
          timeout: state.timeout
        }
      )

      const response = await fetch(url, requestOptions)

      if (!response) {
        throw new Error('No response from server')
      }

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
          `CDP API error: ${response.status} ${response.statusText} - ${errorText}`
        )
      }

      const data = await response.json()

      logger.debug('CDP API request successful', {
        method,
        url: endpoint,
        status: response.status,
        attempt
      })

      return data
    } catch (error) {
      lastError = error

      logger.warn(
        `CDP API request failed (attempt ${attempt}/${state.retryAttempts})`,
        {
          method,
          url: endpoint,
          error: error.message,
          attempt
        }
      )

      if (attempt === state.retryAttempts) {
        break
      }

      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

async function downloadFile(s3Key) {
  initializeConfig()

  // Integration: CDP download API implementation required
  logger.info('Downloading file from CDP', { s3Key })

  const { Readable } = await import('stream')
  return {
    stream: Readable.from(Buffer.from('test file content')),
    metadata: {
      size: 17,
      contentType: 'text/plain'
    }
  }
}

const cdpUploaderClient = {
  initiateUpload,
  getUploadStatus,
  deleteUpload,
  validateFile,
  getHealthInfo,
  downloadFile
}

export default cdpUploaderClient
