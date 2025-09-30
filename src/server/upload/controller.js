import { uploadConfig } from '../../config/upload-config.js'
import { cdpUploaderService } from './services/cdp-uploader-service.js'
import { azureStorageService } from './services/azure-storage-service.js'
import { redisUploadStore } from '../services/redis-upload-store.js'

export const uploadController = {
  async handleUpload(request, h) {
    try {
      const { payload } = request
      const logger = request.logger.child({ component: 'upload-controller' })

      const uploadResult = await cdpUploaderService.uploadFile({
        file: payload.file,
        metadata: {
          originalName: payload.file.hapi.filename,
          contentType: payload.file.hapi.headers['content-type'],
          size: payload.file._readableState?.buffer?.length || 0,
          uploadedBy: request.auth?.credentials?.id || 'anonymous',
          uploadedAt: new Date().toISOString()
        }
      })

      logger.info('File uploaded successfully', {
        uploadId: uploadResult.uploadId,
        filename: payload.file.hapi.filename
      })

      try {
        await redisUploadStore.setUpload(uploadResult.uploadId, {
          uploadId: uploadResult.uploadId,
          filename: uploadResult.filename,
          s3Key: uploadResult.s3Key,
          status: 'awaiting_callback',
          virusScanStatus: 'pending',
          uploadedAt: new Date().toISOString()
        })
      } catch (redisError) {
        logger.warn('Failed to store upload data in Redis', {
          uploadId: uploadResult.uploadId,
          error: redisError.message
        })
      }

      return h
        .response({
          success: true,
          uploadId: uploadResult.uploadId,
          filename: uploadResult.filename,
          message: 'File uploaded successfully and sent for virus scanning'
        })
        .code(201)
    } catch (error) {
      request.logger.error('Upload failed', { error: error.message })
      return h
        .response({
          success: false,
          message: 'Upload failed',
          error: error.message
        })
        .code(500)
    }
  },

  async handleFormSubmission(request, h) {
    try {
      const logger = request.logger.child({ component: 'upload-controller' })
      const { payload } = request
      const { formData, file } = payload

      if (file) {
        const uploadResult = await cdpUploaderService.uploadFile({
          file,
          metadata: {
            formId: formData?.formId,
            submissionId: formData?.submissionId,
            uploadedAt: new Date().toISOString()
          }
        })

        logger.info('Form submission with file processed', {
          uploadId: uploadResult.uploadId,
          formId: formData?.formId
        })

        try {
          await redisUploadStore.setUpload(uploadResult.uploadId, {
            uploadId: uploadResult.uploadId,
            filename: file.hapi?.filename || file.filename,
            s3Key: uploadResult.s3Key,
            status: 'awaiting_callback',
            virusScanStatus: 'pending',
            formData,
            uploadedAt: new Date().toISOString()
          })
        } catch (redisError) {
          logger.warn('Failed to store form upload data in Redis', {
            uploadId: uploadResult.uploadId,
            error: redisError.message
          })
        }

        return h
          .response({
            success: true,
            uploadId: uploadResult.uploadId,
            formSubmissionId: formData?.submissionId,
            message: 'Form submitted successfully'
          })
          .code(201)
      }

      return h
        .response({
          success: true,
          formSubmissionId: formData?.submissionId,
          message: 'Form submitted successfully (no file attached)'
        })
        .code(200)
    } catch (error) {
      request.logger.error('Form submission failed', { error: error.message })
      return h
        .response({
          success: false,
          message: 'Form submission failed',
          error: error.message
        })
        .code(500)
    }
  },

  async getUploadStatus(request, h) {
    try {
      const { uploadId } = request.params

      try {
        const trackedUpload = await redisUploadStore.getUpload(uploadId)
        if (trackedUpload) {
          return h.response({
            success: true,
            ...trackedUpload
          })
        }
      } catch (redisError) {
        request.logger.warn('Failed to get upload from Redis store', {
          uploadId,
          error: redisError.message
        })
      }
      const status = await cdpUploaderService.getUploadStatus(uploadId)

      return h.response({
        success: true,
        uploadId,
        ...status
      })
    } catch (error) {
      request.logger.error('Failed to get upload status', {
        uploadId: request.params.uploadId,
        error: error.message
      })

      return h
        .response({
          success: false,
          message: 'Failed to get upload status',
          error: error.message
        })
        .code(500)
    }
  },

  /**
   * Handle CDP callback - this is where we conditionally transfer to Azure
   */
  async handleCdpCallback(request, h) {
    try {
      const logger = request.logger.child({ component: 'cdp-callback' })
      const { payload, headers } = request

      // Validate callback authentication
      const authToken = headers.authorization?.replace('Bearer ', '')
      const expectedToken =
        uploadConfig.getCdpUploaderConfig().callbackAuthToken

      if (!authToken || authToken !== expectedToken) {
        logger.warn('Unauthorized CDP callback attempt')
        return h.response({ error: 'Unauthorized' }).code(401)
      }

      logger.info('Received CDP callback', {
        uploadId: payload.uploadId,
        status: payload.status,
        virusScanStatus: payload.virusScanStatus
      })

      // Update tracked upload
      let trackedUpload = null
      try {
        trackedUpload = await redisUploadStore.getUpload(payload.uploadId)
        if (trackedUpload) {
          await redisUploadStore.updateUpload(payload.uploadId, {
            status: 'callback_received',
            virusScanStatus: payload.virusScanStatus,
            processedAt: new Date().toISOString()
          })
          // Update local reference for the async operation below
          trackedUpload = {
            ...trackedUpload,
            status: 'callback_received',
            ScanStatus: payload.virusScanStatus,
            processedAt: new Date().toISOString()
          }
        }
      } catch (redisError) {
        logger.warn('Failed to update upload data in Redis', {
          uploadId: payload.uploadId,
          error: redisError.message
        })
        // Continue processing - Redis service handles fallback automatically
      }

      // CRITICAL: Only transfer to Azure if virus scan passed
      if (payload.virusScanStatus === 'clean' || payload.status === 'clean') {
        logger.info('Virus scan passed, initiating direct Azure transfer', {
          uploadId: payload.uploadId
        })

        // Perform Azure transfer asynchronously to avoid timeout
        setImmediate(async () => {
          try {
            // Get the stored file buffer from Redis/memory
            if (!trackedUpload?.fileBuffer) {
              logger.error('No file buffer found for upload', {
                uploadId: payload.uploadId,
                hasTrackedUpload: !!trackedUpload,
                trackedUploadKeys: trackedUpload
                  ? Object.keys(trackedUpload)
                  : []
              })
              return
            }

            // Convert base64 back to buffer if needed
            const fileBuffer = Buffer.isBuffer(trackedUpload.fileBuffer)
              ? trackedUpload.fileBuffer
              : Buffer.from(trackedUpload.fileBuffer, 'base64')

            // Validate buffer is not empty
            if (!fileBuffer || fileBuffer.length === 0) {
              logger.error('File buffer is empty or corrupted', {
                uploadId: payload.uploadId,
                hasBuffer: !!trackedUpload.fileBuffer,
                bufferType: typeof trackedUpload.fileBuffer,
                isBufferInstance: Buffer.isBuffer(trackedUpload.fileBuffer)
              })
              return
            }

            // Get the timestamped spreadsheet filename
            const spreadsheetFilename =
              trackedUpload.originalSpreadsheetName ||
              trackedUpload.filename ||
              'unnamed-file'

            // Determine correct content type for spreadsheet
            const contentType =
              trackedUpload.contentType ||
              (spreadsheetFilename.endsWith('.xlsx')
                ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                : spreadsheetFilename.endsWith('.xls')
                  ? 'application/vnd.ms-excel'
                  : spreadsheetFilename.endsWith('.csv')
                    ? 'text/csv'
                    : 'application/octet-stream')

            // Extract timestamp from filename to verify it matches the JSON
            const timestampMatch = spreadsheetFilename.match(
              /_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/
            )
            const hasMatchingTimestamp =
              timestampMatch &&
              trackedUpload.jsonFilename?.includes(timestampMatch[1])

            logger.info('Uploading spreadsheet to Azure after virus scan', {
              uploadId: payload.uploadId,
              spreadsheetFilename,
              jsonFilename: trackedUpload.jsonFilename,
              originalFilename: trackedUpload.originalFilename,
              timestamp: trackedUpload.timestamp,
              hasMatchingTimestamp,
              size: fileBuffer.length,
              contentType,
              hasContentTypeFromTracked: !!trackedUpload.contentType
            })

            // Upload spreadsheet to Azure with correct content type
            const azureResult = await azureStorageService.uploadFile(
              payload.uploadId,
              {
                buffer: fileBuffer,
                originalname: spreadsheetFilename,
                mimetype: contentType,
                size: fileBuffer.length
              },
              {
                originalName: spreadsheetFilename,
                originalFilename: trackedUpload.originalFilename,
                timestamp: trackedUpload.timestamp,
                contentType,
                type: 'spreadsheet',
                virusScanStatus: 'clean',
                transferredAt: new Date().toISOString()
              }
            )

            // Update tracking and clear the file buffer to save memory
            try {
              await redisUploadStore.updateUpload(payload.uploadId, {
                status: 'completed',
                azureTransferred: true,
                azureBlobName: azureResult.blobName,
                azureUrl: azureResult.url,
                fileBuffer: null // Clear the buffer after successful upload
              })
            } catch (redisError) {
              logger.warn('Failed to update completed upload status in Redis', {
                uploadId: payload.uploadId,
                error: redisError.message
              })
            }

            logger.info('Direct Azure transfer completed', {
              uploadId: payload.uploadId,
              spreadsheetBlobName: azureResult.blobName,
              jsonBlobName: trackedUpload.jsonFilename,
              originalFilename: trackedUpload.originalFilename,
              timestamp: trackedUpload.timestamp,
              bothFilesHaveSameTimestamp: hasMatchingTimestamp
            })
          } catch (error) {
            logger.error('Direct Azure transfer failed', {
              uploadId: payload.uploadId,
              error: error.message
            })

            try {
              await redisUploadStore.updateUpload(payload.uploadId, {
                status: 'transfer_failed',
                transferError: error.message
              })
            } catch (redisError) {
              logger.warn('Failed to update failed transfer status in Redis', {
                uploadId: payload.uploadId,
                error: redisError.message
              })
            }
          }
        })

        return h
          .response({
            success: true,
            message: 'Callback processed, Azure transfer initiated'
          })
          .code(200)
      } else {
        // Virus scan failed or file quarantined
        logger.warn('File failed virus scan or was quarantined', {
          uploadId: payload.uploadId,
          virusScanStatus: payload.virusScanStatus
        })

        try {
          await redisUploadStore.updateUpload(payload.uploadId, {
            status: 'quarantined',
            fileBuffer: null // Clear the buffer for quarantined files
          })
        } catch (redisError) {
          logger.warn('Failed to update quarantined status in Redis', {
            uploadId: payload.uploadId,
            error: redisError.message
          })
        }

        return h
          .response({
            success: true,
            message: 'File quarantined, no Azure transfer'
          })
          .code(200)
      }
    } catch (error) {
      request.logger.error('CDP callback processing failed', {
        error: error.message
      })

      return h
        .response({
          success: false,
          message: 'Callback processing failed',
          error: error.message
        })
        .code(500)
    }
  },

  /**
   * Process upload directly to Azure without S3
   */
  async processUploadDirectly(request, h) {
    try {
      const { uploadId } = request.params
      const logger = request.logger.child({ component: 'upload-processor' })

      logger.info('Starting direct upload processing', { uploadId })

      // Check if upload exists
      const uploadData = await redisUploadStore.getUpload(uploadId)
      if (!uploadData) {
        return h
          .response({
            success: false,
            message: 'Upload not found'
          })
          .code(404)
      }

      // Check if already processed
      if (uploadData.status === 'completed' || uploadData.azureTransferred) {
        return h
          .response({
            success: true,
            message: 'Upload already processed',
            azureUrl: uploadData.azureUrl
          })
          .code(200)
      }

      // Check if virus scan already complete
      if (
        uploadData.virusScanStatus === 'infected' ||
        uploadData.virusScanStatus === 'quarantined'
      ) {
        return h
          .response({
            success: false,
            message: 'File failed virus scan',
            virusScanStatus: uploadData.virusScanStatus
          })
          .code(400)
      }

      // Start async processing
      setImmediate(async () => {
        try {
          const result =
            await cdpUploaderService.processUploadWithAzureTransfer(
              uploadId,
              azureStorageService
            )

          logger.info('Direct upload processing completed', {
            uploadId,
            azureUrl: result.azureResult.url
          })
        } catch (error) {
          logger.error('Direct upload processing failed', {
            uploadId,
            error: error.message
          })
        }
      })

      return h
        .response({
          success: true,
          message: 'Upload processing started',
          uploadId,
          checkStatusUrl: `/upload/status/${uploadId}`
        })
        .code(202)
    } catch (error) {
      request.logger.error('Failed to process upload', {
        uploadId: request.params.uploadId,
        error: error.message
      })

      return h
        .response({
          success: false,
          message: 'Failed to process upload',
          error: error.message
        })
        .code(500)
    }
  },

  /**
   * Health check endpoint
   */
  async healthCheck(request, h) {
    try {
      const cdpHealth = await cdpUploaderService.healthCheck()
      const azureAvailable = uploadConfig.azureConfig.enabled
      const s3Enabled = process.env.S3_ENABLED === 'true'

      return h.response({
        status: 'healthy',
        services: {
          cdpUploader: cdpHealth.healthy ? 'up' : 'down',
          azureStorage: azureAvailable ? 'configured' : 'disabled',
          s3: s3Enabled ? 'configured' : 'disabled (not required)'
        },
        features: {
          directAzureUpload: true,
          virusScanPolling: true,
          s3Download: s3Enabled,
          fileBufferStorage: true
        },
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      return h
        .response({
          status: 'unhealthy',
          error: error.message,
          timestamp: new Date().toISOString()
        })
        .code(503)
    }
  }
}
