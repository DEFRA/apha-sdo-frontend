import Joi from 'joi'
import { uploadController } from './controller.js'

const uploadRoutes = (server) => {
  return [
    {
      method: 'POST',
      path: '/upload',
      options: {
        payload: {
          output: 'stream',
          parse: true,
          multipart: true,
          maxBytes: 52428800 // 50MB
        },
        description: 'Upload spreadsheet file via CDP Uploader to S3',
        notes: 'Validates and uploads .xlsx, .xls, or .csv files',
        tags: ['api', 'upload']
      },
      handler: (request, h) => uploadController.handleUpload(request, h)
    },

    {
      method: 'POST',
      path: '/upload/form-submission',
      options: {
        payload: {
          output: 'stream',
          parse: true,
          multipart: true,
          maxBytes: 52428800 // 50MB
        },
        description: 'Handle form submission with spreadsheet upload',
        notes: 'Processes form data with file upload via CDP uploader',
        tags: ['api', 'upload', 'form']
      },
      handler: (request, h) => uploadController.handleFormSubmission(request, h)
    },

    {
      method: 'GET',
      path: '/upload/status/{uploadId}',
      options: {
        description: 'Check upload status',
        tags: ['api', 'upload', 'status']
      },
      handler: (request, h) => uploadController.getUploadStatus(request, h)
    },

    {
      method: 'POST',
      path: '/upload/callback',
      options: {
        description: 'Handle callback from CDP uploader after virus scanning',
        notes: 'Triggers S3 to Azure transfer after successful CDP processing',
        tags: ['api', 'upload', 'callback'],
        payload: {
          output: 'data',
          parse: true
        }
      },
      handler: (request, h) => uploadController.handleCdpCallback(request, h)
    },

    {
      method: 'POST',
      path: '/upload/process/{uploadId}',
      options: {
        description: 'Process uploaded file (virus scan + Azure transfer)',
        notes:
          'Polls CDP for virus scan status and uploads directly to Azure without S3',
        tags: ['api', 'upload', 'process'],
        validate: {
          params: Joi.object({
            uploadId: Joi.string().uuid().required()
          })
        }
      },
      handler: (request, h) =>
        uploadController.processUploadDirectly(request, h)
    },

    {
      method: 'GET',
      path: '/upload/health',
      options: {
        description: 'Check upload service health',
        tags: ['api', 'health', 'upload']
      },
      handler: (request, h) => uploadController.healthCheck(request, h)
    }
  ]
}

export { uploadRoutes }
