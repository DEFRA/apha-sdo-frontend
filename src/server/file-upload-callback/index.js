import Joi from 'joi'
import { fileUploadCallbackController } from './controller.js'

/**
 * File Upload Callback Routes
 * Handles callbacks from CDP-Uploader service
 */
export default [
  {
    method: 'POST',
    path: '/file',
    handler: fileUploadCallbackController.handler,
    options: {
      description:
        'Handle file upload callback from CDP-Uploader (forms-engine route)',
      tags: ['api', 'file-upload'],
      plugins: {
        // Disable CSRF protection for external callbacks
        crumb: false
      },
      validate: {
        payload: Joi.object({
          uploadId: Joi.string()
            .uuid()
            .required()
            .description('Unique upload session identifier'),
          status: Joi.string()
            .valid('completed', 'failed', 'cancelled')
            .required()
            .description('Upload status'),
          retrievalKey: Joi.string()
            .required()
            .description('File retrieval key'),
          metadata: Joi.object().optional().description('Additional metadata'),
          files: Joi.array()
            .items(
              Joi.object({
                filename: Joi.string().required(),
                size: Joi.number().required(),
                mimetype: Joi.string().required(),
                url: Joi.string().uri().required(),
                checksum: Joi.string().optional()
              })
            )
            .optional()
            .description('Uploaded files information'),
          error: Joi.string()
            .optional()
            .description('Error message if upload failed'),
          timestamp: Joi.date()
            .iso()
            .optional()
            .description('Callback timestamp')
        }).required()
      },
      response: {
        schema: Joi.object({
          success: Joi.boolean().required(),
          message: Joi.string().optional(),
          error: Joi.string().optional()
        })
      }
    }
  },
  {
    method: 'POST',
    path: '/file-upload-callback',
    handler: fileUploadCallbackController.handler,
    options: {
      description: 'Handle file upload callback from CDP-Uploader',
      tags: ['api', 'file-upload'],
      plugins: {
        // Disable CSRF protection for external callbacks
        crumb: false
      },
      validate: {
        payload: Joi.object({
          uploadId: Joi.string()
            .uuid()
            .required()
            .description('Unique upload session identifier'),
          status: Joi.string()
            .valid('completed', 'failed', 'cancelled')
            .required()
            .description('Upload status'),
          retrievalKey: Joi.string()
            .required()
            .description('File retrieval key'),
          metadata: Joi.object().optional().description('Additional metadata'),
          files: Joi.array()
            .items(
              Joi.object({
                filename: Joi.string().required(),
                size: Joi.number().required(),
                mimetype: Joi.string().required(),
                url: Joi.string().uri().required(),
                checksum: Joi.string().optional()
              })
            )
            .optional()
            .description('Uploaded files information'),
          error: Joi.string()
            .optional()
            .description('Error message if upload failed'),
          timestamp: Joi.date()
            .iso()
            .optional()
            .description('Callback timestamp')
        }).required()
      },
      response: {
        schema: Joi.object({
          success: Joi.boolean().required(),
          message: Joi.string().optional(),
          error: Joi.string().optional()
        })
      }
    }
  },
  {
    method: 'GET',
    path: '/file-upload-callback/health',
    handler: fileUploadCallbackController.healthHandler,
    options: {
      description: 'Health check for file upload callback service',
      tags: ['health'],
      plugins: {
        crumb: false
      },
      response: {
        schema: Joi.object({
          status: Joi.string().required(),
          timestamp: Joi.date().iso().required(),
          service: Joi.string().required()
        })
      }
    }
  },
  {
    method: 'GET',
    path: '/file-upload-callback/metrics',
    handler: fileUploadCallbackController.metricsHandler,
    options: {
      description: 'Get upload service metrics',
      tags: ['metrics'],
      plugins: {
        crumb: false
      },
      response: {
        schema: Joi.object({
          sessions: Joi.object().required(),
          security: Joi.object().required(),
          service: Joi.object().required()
        })
      }
    }
  },
  {
    method: 'GET',
    path: '/file-upload-callback/status/{uploadId}',
    handler: fileUploadCallbackController.statusHandler,
    options: {
      description: 'Get upload status by ID',
      tags: ['api', 'file-upload'],
      plugins: {
        crumb: false
      },
      validate: {
        params: Joi.object({
          uploadId: Joi.string()
            .uuid()
            .required()
            .description('Upload session ID')
        })
      },
      response: {
        schema: Joi.object({
          uploadId: Joi.string().required(),
          status: Joi.string().required(),
          sessionInfo: Joi.object().optional()
        })
      }
    }
  }
]
