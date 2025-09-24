import Boom from '@hapi/boom'
import uploadService from '../services/upload-service.js'
import azureUploadHandler from './azureUploadHandler.js'
import uploadSessionManager from '../services/upload-session-manager.js'
import { config } from '../../config/config.js'
import { logger } from '../common/helpers/logging/logger.js'

export const fileUploadCallbackController = {
  handler: async (request, h) => {
    const { payload } = request

    try {
      logger.info('Received file upload callback', {
        uploadId: payload?.uploadId,
        status: payload?.status,
        retrievalKey: payload?.retrievalKey
      })
      if (!payload?.uploadId || !payload?.status) {
        logger.error('Invalid callback payload - missing required fields', {
          payload
        })
        return Boom.badRequest('Invalid callback payload')
      }

      const result = await uploadService.processUploadCallback(payload, request)
      let formData = null
      try {
        formData = uploadSessionManager.getFormData(payload.uploadId)
        if (formData) {
          logger.info('Retrieved form data from session for Azure upload', {
            uploadId: payload.uploadId,
            formFieldCount: Object.keys(formData).length
          })
        }
      } catch (error) {
        logger.warn('Could not retrieve form data from session', {
          uploadId: payload.uploadId,
          error: error.message
        })
      }

      let azureEnabled = false
      let backgroundProcessingEnabled = false

      try {
        azureEnabled = config.get('azureStorage.enabled')
      } catch (configError) {
        logger.warn(
          'Failed to get Azure storage configuration, skipping Azure processing',
          {
            error: configError.message
          }
        )
      }

      try {
        backgroundProcessingEnabled = config.get(
          'azureStorage.enableBackgroundProcessing'
        )
      } catch (configError) {
        logger.warn(
          'Failed to get background processing configuration, using synchronous processing',
          {
            error: configError.message
          }
        )
      }

      if (result.success && azureEnabled) {
        try {
          logger.debug('Processing callback with Azure handler', {
            uploadId: payload.uploadId,
            status: payload.status
          })

          if (backgroundProcessingEnabled) {
            setImmediate(async () => {
              try {
                await azureUploadHandler.processUploadCallback(
                  payload,
                  request,
                  formData
                )
                logger.info('Azure background processing completed', {
                  uploadId: payload.uploadId,
                  hasFormData: !!formData
                })
              } catch (azureError) {
                logger.error('Azure background processing failed', {
                  uploadId: payload.uploadId,
                  error: azureError.message
                })
              }
            })
          } else {
            const azureResult = await azureUploadHandler.processUploadCallback(
              payload,
              request,
              formData
            )
            logger.info('Azure processing completed synchronously', {
              uploadId: payload.uploadId,
              azureSuccess: azureResult.success,
              hasFormData: !!formData
            })
          }
        } catch (azureError) {
          logger.error('Azure processing failed', {
            uploadId: payload.uploadId,
            error: azureError.message,
            stack: azureError.stack
          })

          if (!backgroundProcessingEnabled) {
            return h
              .response({
                success: false,
                error: 'Azure processing failed',
                details: azureError.message
              })
              .code(500)
          }
        }
      }

      if (result.success) {
        logger.info('Callback processed successfully', {
          uploadId: payload.uploadId,
          status: payload.status,
          azureEnabled,
          backgroundProcessing: backgroundProcessingEnabled
        })

        return h
          .response({
            success: true,
            message: 'Callback processed successfully'
          })
          .code(200)
      } else {
        logger.error('Callback processing failed', {
          uploadId: payload.uploadId,
          error: result.error
        })

        return h
          .response({
            success: false,
            error: result.error || 'Processing failed'
          })
          .code(400)
      }
    } catch (error) {
      logger.error('Callback handler error', {
        error: error.message,
        stack: error.stack,
        uploadId: payload?.uploadId
      })

      return Boom.internal('Callback processing error')
    }
  },

  healthHandler: async (request, h) => {
    return h
      .response({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'file-upload-callback'
      })
      .code(200)
  },

  metricsHandler: async (request, h) => {
    try {
      const metrics = uploadService.getHealthMetrics()

      let azureEnabled = false
      try {
        azureEnabled = config.get('azureStorage.enabled')
      } catch (configError) {
        logger.warn('Failed to get Azure configuration for metrics', {
          error: configError.message
        })
      }

      if (azureEnabled) {
        try {
          metrics.azureHandler = azureUploadHandler.getMetrics()
        } catch (azureError) {
          logger.warn('Failed to get Azure handler metrics', {
            error: azureError.message
          })
          metrics.azureHandler = { error: 'Failed to retrieve metrics' }
        }
      }

      return h.response(metrics).code(200)
    } catch (error) {
      logger.error('Failed to get metrics', { error: error.message })
      return Boom.internal('Failed to get metrics')
    }
  },

  statusHandler: async (request, h) => {
    const { uploadId } = request.params

    try {
      logger.info('Status request for upload', { uploadId })

      const status = await uploadService.getUploadStatus(uploadId)

      return h.response(status).code(200)
    } catch (error) {
      logger.error('Failed to get upload status', {
        error: error.message,
        uploadId
      })

      return Boom.notFound('Upload not found or status unavailable')
    }
  }
}
