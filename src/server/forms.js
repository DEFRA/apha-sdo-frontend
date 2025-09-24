import Boom from '@hapi/boom'
import {
  metadata as exampleMetadata,
  definition as exampleDefinition
} from './forms/example-form.js'
import {
  metadata as contactMetadata,
  definition as contactDefinition
} from './forms/contact-form.js'
import {
  metadata as batRabiesMetadata,
  definition as batRabiesDefinition
} from './forms/bat-rabies.js'
import uploadService from './services/upload-service.js'
import uploadSessionManager from './services/upload-session-manager.js'
import { logger } from './common/helpers/logging/logger.js'

const formsService = {
  getFormMetadata: function (slug) {
    switch (slug) {
      case exampleMetadata.slug:
        return Promise.resolve(exampleMetadata)
      case contactMetadata.slug:
        return Promise.resolve(contactMetadata)
      case batRabiesMetadata.slug:
        return Promise.resolve(batRabiesMetadata)
      default:
        throw Boom.notFound(`Form '${slug}' not found`)
    }
  },
  getFormDefinition: function (id) {
    switch (id) {
      case exampleMetadata.id:
        return Promise.resolve(exampleDefinition)
      case contactMetadata.id:
        return Promise.resolve(contactDefinition)
      case batRabiesMetadata.id:
        return Promise.resolve(batRabiesDefinition)
      default:
        throw Boom.notFound(`Form '${id}' not found`)
    }
  }
}

// Production form submission service using CDP-Uploader
const formSubmissionService = {
  uploadFile: async (
    file,
    formId,
    options = {},
    request = null,
    formData = null
  ) => {
    // Extract client IP from request for rate limiting
    const clientIp =
      request?.info?.remoteAddress ||
      request?.headers?.['x-forwarded-for'] ||
      request?.headers?.['x-real-ip'] ||
      'unknown'

    logger.info('Processing file upload', {
      formId,
      filename: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
      clientIp
    })

    try {
      const uploadOptions = {
        ...options,
        clientIp,
        formData // Pass form data for JSON file creation
      }

      const result = await uploadService.uploadFile(file, formId, uploadOptions)

      logger.info('File upload processed successfully', {
        uploadId: result.id,
        formId,
        filename: file.originalname,
        rateLimitRemaining: result.rateLimitInfo?.remaining
      })

      return result
    } catch (error) {
      // Enhanced error handling for rate limiting and security
      if (error.retryAfter) {
        const rateLimitError = new Error(
          `Rate limit exceeded. ${error.message}`
        )
        rateLimitError.statusCode = 429
        rateLimitError.retryAfter = error.retryAfter
        throw rateLimitError
      }

      logger.error('File upload failed', {
        error: error.message,
        formId,
        filename: file.originalname,
        clientIp
      })
      throw error
    }
  },

  deleteFile: async (uploadId) => {
    logger.info('Processing file deletion', { uploadId })

    try {
      const result = await uploadService.deleteFile(uploadId)

      logger.info('File deletion processed successfully', { uploadId })

      return result
    } catch (error) {
      logger.error('File deletion failed', {
        error: error.message,
        uploadId
      })
      throw error
    }
  },

  getUploadStatus: async (uploadId) => {
    try {
      return await uploadService.getUploadStatus(uploadId)
    } catch (error) {
      logger.error('Upload status check failed', {
        error: error.message,
        uploadId
      })
      throw error
    }
  },

  submit: async (formData, formId, request = null) => {
    logger.info('Processing form submission', { formId })

    try {
      // Process any file uploads in the form data, passing form data for JSON creation
      const processedData = await formSubmissionService._processFormFiles(
        formData,
        formId,
        request
      )

      // Submit the form with processed file references
      const submission = {
        id: `submission-${Date.now()}`,
        formId,
        submittedAt: new Date().toISOString(),
        status: 'submitted',
        data: processedData
      }

      logger.info('Form submission processed successfully', {
        submissionId: submission.id,
        formId
      })

      return submission
    } catch (error) {
      logger.error('Form submission failed', {
        error: error.message,
        formId
      })
      throw error
    }
  },

  async _processFormFiles(formData, formId, request = null) {
    // Deep clone the form data to avoid mutations
    const processedData = JSON.parse(JSON.stringify(formData))

    // Process any file references in the form data
    const fileFields = formSubmissionService._findFileFields(processedData)

    for (const field of fileFields) {
      if (
        field.value &&
        typeof field.value === 'object' &&
        field.value.uploadId
      ) {
        // Get the current status of the upload
        try {
          const status = await formSubmissionService.getUploadStatus(
            field.value.uploadId
          )
          field.value.status = status.status
          field.value.lastChecked = new Date().toISOString()

          // Store form data with the upload session for Azure JSON creation
          try {
            uploadSessionManager.storeFormData(
              field.value.uploadId,
              processedData
            )
            logger.info('Associated form data with upload session', {
              uploadId: field.value.uploadId,
              formId
            })
          } catch (storeError) {
            logger.warn('Could not store form data with upload session', {
              uploadId: field.value.uploadId,
              error: storeError.message
            })
          }
        } catch (error) {
          logger.warn('Could not get upload status for file field', {
            uploadId: field.value.uploadId,
            error: error.message
          })
        }
      }
    }

    return processedData
  },

  _findFileFields(obj, path = '') {
    const fileFields = []

    if (obj && typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        const currentPath = path ? `${path}.${key}` : key

        if (value && typeof value === 'object') {
          if (value.uploadId && value.originalName) {
            // This looks like a file field
            fileFields.push({
              path: currentPath,
              value
            })
          } else {
            // Recursively check nested objects
            fileFields.push(
              ...formSubmissionService._findFileFields(value, currentPath)
            )
          }
        }
      }
    }

    return fileFields
  }
}

// Mock output service for form submissions
const outputService = {
  submitForm: async (formId, formData) => {
    console.log(`Mock form submission for form ${formId}:`, formData)
    return {
      id: `submission-${Date.now()}`,
      formId,
      submittedAt: new Date().toISOString(),
      status: 'submitted',
      data: formData
    }
  },

  submit: async (formData, formId) => {
    console.log(`Mock output service submission for form ${formId}:`, formData)
    return {
      id: `output-${Date.now()}`,
      formId,
      submittedAt: new Date().toISOString(),
      status: 'submitted',
      data: formData
    }
  }
}

// Mock user service
const userService = {
  getUser: async (credentials) => {
    return {
      id: credentials?.userId || 'anonymous',
      username: credentials?.username || 'Anonymous User',
      email: credentials?.email || 'anonymous@example.com'
    }
  }
}

export default {
  formsService,
  formSubmissionService,
  outputService,
  userService
}
