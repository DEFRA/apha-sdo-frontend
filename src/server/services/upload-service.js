import crypto from 'crypto'
import cdpUploaderClient from './cdp-uploader-client.js'
import uploadSessionManager from './upload-session-manager.js'
import {
  validateFileUpload,
  checkRateLimit,
  getSecurityMetrics
} from './upload-security.js'
import { logger } from '../common/helpers/logging/logger.js'
import { config } from '../../config/config.js'

const isProduction = config.get('isProduction')

/**
 * Upload file via CDP-Uploader to Azure Blob Storage
 */
export async function uploadFile(file, formId, options = {}) {
  const {
    allowedMimeTypes = [],
    metadata = {},
    formData = null,
    clientIp = 'unknown'
  } = options

  try {
    const securityValidation = validateFileUpload(file, {
      allowedMimeTypes
    })
    if (!securityValidation.valid) {
      throw new Error(
        `Security validation failed: ${securityValidation.errors.join(', ')}`
      )
    }

    const rateLimitResult = checkRateLimit(clientIp, file.size)
    if (!rateLimitResult.allowed) {
      const error = new Error(`Rate limit exceeded: ${rateLimitResult.reason}`)
      error.retryAfter = rateLimitResult.retryAfter
      throw error
    }

    if (!isProduction) {
      return _mockUpload(file, formId)
    }

    const validation = cdpUploaderClient.validateFile(file, allowedMimeTypes)
    if (!validation.valid) {
      throw new Error(`File validation failed: ${validation.errors.join(', ')}`)
    }

    const retrievalKey = _generateRetrievalKey(formId, file.originalname)

    const sessionMetadata = {
      originalName: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
      formId,
      clientIp,
      formData, // Include form data in metadata
      ...metadata
    }

    const uploadResponse = await cdpUploaderClient.initiateUpload({
      formPath: `/forms/${formId}`,
      retrievalKey,
      mimeTypes: allowedMimeTypes,
      metadata: sessionMetadata
    })

    uploadSessionManager.createSession(uploadResponse.uploadId, sessionMetadata)

    if (formData) {
      uploadSessionManager.storeFormData(uploadResponse.uploadId, formData)
      logger.info('Form data stored in session for Azure JSON upload', {
        uploadId: uploadResponse.uploadId,
        formFieldCount: Object.keys(formData).length
      })
    }

    logger.info('File upload initiated successfully', {
      uploadId: uploadResponse.uploadId,
      retrievalKey,
      formId,
      originalName: file.originalname
    })

    const result = {
      id: uploadResponse.uploadId,
      retrievalKey,
      originalName: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
      status: 'initiated',
      uploadUrl: uploadResponse.uploadUrl,
      formId,
      metadata: uploadResponse.metadata,
      rateLimitInfo: {
        remaining: rateLimitResult.remaining,
        resetTime: rateLimitResult.resetTime
      }
    }

    return result
  } catch (error) {
    logger.error('File upload failed', {
      error: error.message,
      formId,
      originalName: file.originalname,
      size: file.size
    })
    const uploadError = new Error(`Upload failed: ${error.message}`)
    if (error.retryAfter) {
      uploadError.retryAfter = error.retryAfter
    }
    throw uploadError
  }
}

/**
 * Delete uploaded file from Azure Blob Storage
 */
export async function deleteFile(uploadId) {
  if (!isProduction) {
    return _mockDelete(uploadId)
  }

  try {
    await cdpUploaderClient.deleteUpload(uploadId)

    logger.info('File deleted successfully', { uploadId })

    return {
      success: true,
      uploadId,
      deletedAt: new Date().toISOString()
    }
  } catch (error) {
    logger.error('File deletion failed', {
      error: error.message,
      uploadId
    })
    throw new Error(`Deletion failed: ${error.message}`)
  }
}

/**
 * Get upload status and progress
 */
export async function getUploadStatus(uploadId) {
  try {
    const session = uploadSessionManager.getSession(uploadId)
    let sessionInfo = null

    if (session) {
      sessionInfo = {
        sessionStatus: session.status,
        progress: session.progress,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        attempts: session.attempts
      }
    }

    if (!isProduction) {
      const mockStatus = await _mockStatus(uploadId)
      return {
        ...mockStatus,
        sessionInfo
      }
    }

    const cdpStatus = await cdpUploaderClient.getUploadStatus(uploadId)

    return {
      ...cdpStatus,
      sessionInfo
    }
  } catch (error) {
    logger.error('Status check failed', {
      error: error.message,
      uploadId
    })
    throw new Error(`Status check failed: ${error.message}`)
  }
}

/**
 * Process upload completion callback from CDP-Uploader
 * Security: Validates callback authentication
 */
export async function processUploadCallback(callbackData, request = null) {
  const {
    uploadId,
    status,
    retrievalKey,
    metadata,
    files,
    error: callbackError
  } = callbackData

  try {
    // Security: Validate callback authentication
    if (request && !validateCallbackAuthentication(request, uploadId)) {
      logger.error('Callback security validation failed', { uploadId })
      throw new Error('Invalid callback request')
    }

    logger.info('Processing upload callback', {
      uploadId,
      status,
      retrievalKey,
      fileCount: files?.length || 0
    })

    const session = uploadSessionManager.getSession(uploadId)
    if (session) {
      logger.debug('Found upload session', {
        uploadId,
        sessionStatus: session.status,
        createdAt: session.createdAt
      })
    }

    let result
    switch (status) {
      case 'completed':
        result = await _handleUploadCompleted(
          uploadId,
          retrievalKey,
          metadata,
          files
        )
        if (session) {
          uploadSessionManager.completeSession(uploadId, result)
        }
        break
      case 'failed':
        result = await _handleUploadFailed(
          uploadId,
          retrievalKey,
          metadata,
          callbackError
        )
        if (session) {
          uploadSessionManager.failSession(
            uploadId,
            new Error(callbackError || 'Upload failed')
          )
        }
        break
      case 'cancelled':
        result = await _handleUploadCancelled(uploadId, retrievalKey, metadata)
        if (session) {
          uploadSessionManager.updateSession(uploadId, { status: 'cancelled' })
        }
        break
      default:
        logger.warn('Unknown upload status received', { uploadId, status })
        result = { success: false, error: 'Unknown status' }
        if (session) {
          uploadSessionManager.failSession(
            uploadId,
            new Error('Unknown status')
          )
        }
    }

    return result
  } catch (error) {
    logger.error('Callback processing failed', {
      error: error.message,
      uploadId,
      retrievalKey
    })

    const session = uploadSessionManager.getSession(uploadId)
    if (session) {
      uploadSessionManager.failSession(uploadId, error)
    }

    throw new Error(`Callback processing failed: ${error.message}`)
  }
}

/**
 * Get service health metrics
 */
export function getHealthMetrics() {
  return {
    sessions: uploadSessionManager.getHealthMetrics(),
    security: getSecurityMetrics(),
    service: {
      isProduction,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    }
  }
}

function _generateRetrievalKey(formId, filename) {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 15)
  return `${formId}-${timestamp}-${random}`
}

async function _handleUploadCompleted(uploadId, retrievalKey, metadata, files) {
  logger.info('Upload completed successfully', {
    uploadId,
    retrievalKey,
    fileCount: files?.length || 0
  })

  return {
    success: true,
    uploadId,
    retrievalKey,
    status: 'completed',
    files: files || [],
    completedAt: new Date().toISOString(),
    metadata
  }
}

async function _handleUploadFailed(
  uploadId,
  retrievalKey,
  metadata,
  callbackError
) {
  const errorMsg = callbackError || metadata?.error || 'Upload failed'

  logger.error('Upload failed', {
    uploadId,
    retrievalKey,
    error: errorMsg
  })

  return {
    success: false,
    uploadId,
    retrievalKey,
    status: 'failed',
    error: errorMsg,
    failedAt: new Date().toISOString(),
    metadata
  }
}

async function _handleUploadCancelled(uploadId, retrievalKey, metadata) {
  logger.info('Upload cancelled', { uploadId, retrievalKey })

  return {
    success: false,
    uploadId,
    retrievalKey,
    status: 'cancelled',
    cancelledAt: new Date().toISOString()
  }
}

/**
 * Security: Validate callback authentication with timing-safe comparison
 */
function validateCallbackAuthentication(request, uploadId) {
  if (!request || !request.headers) {
    return false
  }

  const authHeader =
    request.headers.authorization || request.headers['x-api-key']
  if (!authHeader) {
    logger.warn('Callback request missing authentication', { uploadId })
    return false
  }

  // Security: Verify against configured auth token
  const expectedToken = config.get('cdpUploader.callbackAuthToken')
  if (!expectedToken) {
    logger.error('Callback authentication token not configured')
    return false
  }

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader

  // Security: Constant-time comparison prevents timing attacks
  const isValid =
    token.length === expectedToken.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken))

  if (!isValid) {
    logger.warn('Invalid callback authentication token', { uploadId })
  }

  return isValid
}

function _mockUpload(file, formId) {
  logger.info('Mock file upload', { formId, filename: file.originalname })

  const mockId = `mock-${Date.now()}`
  const mockSession = {
    originalName: file.originalname,
    size: file.size,
    mimetype: file.mimetype,
    formId
  }

  uploadSessionManager.createSession(mockId, mockSession)

  setTimeout(() => {
    uploadSessionManager.completeSession(mockId, {
      url: `/uploads/${file.originalname}`
    })
  }, 100)

  return Promise.resolve({
    id: mockId,
    retrievalKey: `mock-key-${Date.now()}`,
    originalName: file.originalname,
    size: file.size,
    mimetype: file.mimetype,
    status: 'completed',
    url: `/uploads/${file.originalname}`,
    formId
  })
}

function _mockDelete(uploadId) {
  logger.info('Mock file deletion', { uploadId })
  return Promise.resolve({ success: true, uploadId })
}

function _mockStatus(uploadId) {
  return Promise.resolve({
    uploadId,
    status: 'completed',
    progress: 100
  })
}

const uploadService = {
  uploadFile,
  deleteFile,
  getUploadStatus,
  processUploadCallback,
  getHealthMetrics,
  _generateRetrievalKey
}

export default uploadService
