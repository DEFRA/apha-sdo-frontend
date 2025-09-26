import { uploadRoutes } from './routes.js'
import {
  initializeUploadPipeline,
  getUploadPipelineHealth,
  triggerProcessing,
  retryFailedTransfers
} from './initialize.js'

const uploadPlugin = {
  name: 'upload',
  version: '1.0.0',
  register: async (server) => {
    // Initialize the upload pipeline orchestrator
    try {
      await initializeUploadPipeline(server.logger)
      server.logger.info('Upload pipeline initialized successfully')
    } catch (error) {
      server.logger.error('Failed to initialize upload pipeline', error)
      // Continue anyway - the system can still work without orchestrator
    }

    // Register upload routes
    const routes = uploadRoutes(server)
    server.route(routes)

    // Add pipeline management routes
    server.route([
      {
        method: 'GET',
        path: '/upload/pipeline/health',
        handler: async (request, h) => {
          const health = await getUploadPipelineHealth()
          return h.response(health).code(health.healthy ? 200 : 503)
        }
      },
      {
        method: 'POST',
        path: '/upload/pipeline/trigger',
        handler: async (request, h) => {
          await triggerProcessing()
          return h.response({ message: 'Processing triggered' })
        }
      },
      {
        method: 'POST',
        path: '/upload/pipeline/retry',
        handler: async (request, h) => {
          const result = await retryFailedTransfers()
          return h.response(result)
        }
      }
    ])

    // Add global error handler for upload errors
    server.ext('onPreResponse', (request, h) => {
      const response = request.response

      if (response.isBoom && response.output.statusCode === 413) {
        server.logger.warn('File size limit exceeded', {
          path: request.path,
          contentLength: request.headers['content-length']
        })

        return h
          .response({
            error: 'File too large',
            message: 'File size exceeds the maximum allowed limit of 50MB'
          })
          .code(413)
      }

      if (
        response.isBoom &&
        response.message?.includes('Unsupported Media Type')
      ) {
        return h
          .response({
            error: 'Unsupported file type',
            message: 'Only .xlsx, .xls, and .csv files are supported'
          })
          .code(415)
      }

      return h.continue
    })

    server.logger.info('Upload plugin registered successfully')
  }
}

export { uploadPlugin }

// Also export utilities for direct use
export {
  initializeUploadPipeline,
  getUploadPipelineHealth,
  triggerProcessing,
  retryFailedTransfers
}
