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

import { cdpUploaderService } from './upload/services/cdp-uploader-service.js'
import { azureStorageService } from './upload/services/azure-storage-service.js'
import { fileValidationService } from './upload/services/file-validation-service.js'
import { uploadConfig } from '../config/upload-config.js'

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

const formSubmissionService = {
  /**
   * Persist files by extending the time-to-live to 30 days
   * This is required by the forms-engine-plugin's SummaryPageController
   */
  persistFiles: async (files, persistedRetrievalKey) => {
    // For now, we'll just return a resolved promise since we're handling file persistence
    // through our own CDP uploader service.
    console.log(
      `Persisting ${files.length} files with retrieval key: ${persistedRetrievalKey}`
    )

    return Promise.resolve({
      success: true,
      persistedFiles: files.length,
      retrievalKey: persistedRetrievalKey
    })
  },

  uploadFile: async (file, formId) => {
    try {
      // Validate the file first
      const validation = await fileValidationService.validateFile(file)
      if (!validation.isValid) {
        throw new Error(
          `File validation failed: ${validation.errors.join(', ')}`
        )
      }

      // Upload using CDP uploader service
      const uploadResult = await cdpUploaderService.uploadFile({
        file: file.stream || file,
        metadata: {
          originalName: file.originalname || file.filename || file.name,
          contentType: file.mimetype || file.type || 'application/octet-stream',
          size: file.size || file.length || 0,
          formId,
          uploadedAt: new Date().toISOString()
        }
      })

      // Also upload to Azure if configured
      if (uploadConfig.azureConfig?.enabled) {
        try {
          await azureStorageService.uploadFile(uploadResult.uploadId, file)
        } catch (azureError) {
          console.warn(
            'Azure upload failed but CDP upload succeeded:',
            azureError.message
          )
        }
      }

      return {
        id: uploadResult.uploadId,
        originalName: uploadResult.filename,
        size: uploadResult.size,
        s3Key: uploadResult.s3Key,
        url: `/download/${uploadResult.uploadId}`
      }
    } catch (error) {
      console.error(`File upload failed for form ${formId}:`, error)
      throw error
    }
  },

  /**
   * Upload file and form data with JSON creation
   */
  uploadFileWithFormData: async (file, formData, formId) => {
    try {
      // Prepare form data JSON
      const jsonData = {
        ...formData,
        formId,
        submittedAt: new Date().toISOString(),
        submittedBy: formData.submittedBy || 'anonymous'
      }

      // Remove file fields from JSON
      delete jsonData.file
      delete jsonData.supportingDocuments

      if (file) {
        // Validate the file
        const validation = await fileValidationService.validateFile(file)
        if (!validation.isValid) {
          throw new Error(
            `File validation failed: ${validation.errors.join(', ')}`
          )
        }

        const originalFilename =
          file.originalname || file.filename || file.name || 'submission'
        const filenameBase = originalFilename.replace(/\.[^/.]+$/, '')
        // const timestamp = Date.now()
        // const uniqueBase = `${timestamp}_${filenameBase}`

        // Upload spreadsheet via CDP uploader
        const uploadResult = await cdpUploaderService.uploadFile({
          file: file.stream || file,
          metadata: {
            originalName: originalFilename,
            contentType:
              file.mimetype || file.type || 'application/octet-stream',
            size: file.size || file.length || 0,
            formId,
            type: 'spreadsheet',
            uploadedAt: jsonData.submittedAt
          }
        })

        // If Azure is enabled, upload both spreadsheet and JSON
        if (uploadConfig.azureConfig?.enabled) {
          try {
            // Upload spreadsheet to Azure
            await azureStorageService.uploadFile(uploadResult.uploadId, file, {
              originalName: originalFilename,
              type: 'spreadsheet'
            })

            // Create and upload JSON file with same base name
            const jsonFilename = `${filenameBase}.json`
            const jsonContent = JSON.stringify(jsonData, null, 2)
            const jsonBuffer = Buffer.from(jsonContent, 'utf-8')

            const jsonFile = {
              buffer: jsonBuffer,
              originalname: jsonFilename,
              mimetype: 'application/json',
              size: jsonBuffer.length
            }

            await azureStorageService.uploadFile(
              uploadResult.uploadId,
              jsonFile,
              {
                originalName: jsonFilename,
                contentType: 'application/json',
                type: 'form-data',
                relatedSpreadsheet: originalFilename
              }
            )

            console.log('Both spreadsheet and JSON uploaded to Azure', {
              uploadId: uploadResult.uploadId,
              spreadsheet: originalFilename,
              json: jsonFilename
            })
          } catch (azureError) {
            console.warn('Azure upload failed:', azureError.message)
          }
        }

        return {
          id: uploadResult.uploadId,
          originalName: uploadResult.filename,
          size: uploadResult.size,
          s3Key: uploadResult.s3Key,
          url: `/download/${uploadResult.uploadId}`,
          jsonCreated: uploadConfig.azureConfig?.enabled
        }
      } else {
        // No file, just save form data as JSON if Azure is enabled
        if (uploadConfig.azureConfig?.enabled) {
          const timestamp = Date.now()
          const jsonFilename = `form_submission_${timestamp}.json`
          const jsonContent = JSON.stringify(jsonData, null, 2)
          const jsonBuffer = Buffer.from(jsonContent, 'utf-8')

          const jsonFile = {
            buffer: jsonBuffer,
            originalname: jsonFilename,
            mimetype: 'application/json',
            size: jsonBuffer.length
          }

          const uploadId = `form_${timestamp}`
          await azureStorageService.uploadFile(uploadId, jsonFile, {
            originalName: jsonFilename,
            contentType: 'application/json',
            type: 'form-data-only'
          })

          return {
            id: uploadId,
            originalName: jsonFilename,
            size: jsonBuffer.length,
            jsonOnly: true
          }
        }

        throw new Error('No file provided and Azure storage not enabled')
      }
    } catch (error) {
      console.error(
        `File upload with form data failed for form ${formId}:`,
        error
      )
      throw error
    }
  },

  deleteFile: async (fileId) => {
    try {
      // Delete from S3 if possible
      /*
      if (s3DownloadService.deleteFile) {
        await s3DownloadService.deleteFile(fileId)
    }
    */

      // Delete from Azure if enabled
      if (uploadConfig.azureConfig?.enabled && azureStorageService.deleteFile) {
        await azureStorageService.deleteFile(fileId)
      }

      return { success: true }
    } catch (error) {
      console.error(`File deletion failed for file ${fileId}:`, error)
      throw error
    }
  },

  submit: async (formData, formId) => {
    try {
      // Check if we have a file to upload along with form data
      const file =
        formData.file ||
        (formData.files && formData.files[0]) ||
        formData.supportingDocuments

      if (file || uploadConfig.azureConfig?.enabled) {
        // Use the new method that handles both file and JSON
        const uploadResult = await formSubmissionService.uploadFileWithFormData(
          file,
          formData,
          formId
        )

        return {
          id: uploadResult.id,
          formId,
          submittedAt: new Date().toISOString(),
          status: 'submitted',
          uploadResult,
          data: formData
        }
      } else {
        // Legacy path for forms without files
        if (formData.files && Array.isArray(formData.files)) {
          const uploadPromises = formData.files.map((file) =>
            formSubmissionService.uploadFile(file, formId)
          )
          const uploadResults = await Promise.all(uploadPromises)
          formData.uploadedFiles = uploadResults
        }

        console.log(`Form submission for form ${formId} with uploaded files`)
        return {
          id: `submission-${Date.now()}`,
          formId,
          submittedAt: new Date().toISOString(),
          status: 'submitted',
          data: formData
        }
      }
    } catch (error) {
      console.error(`Form submission failed for form ${formId}:`, error)
      throw error
    }
  },

  getUploadStatus: async (uploadId) => {
    return await cdpUploaderService.getUploadStatus(uploadId)
  },

  generateDownloadUrl: async (fileId) => {
    try {
      // Try S3 first
      /*
      if (s3DownloadService) {
        return await s3DownloadService.generateDownloadUrl(fileId)
      }
      */

      // Fallback to Azure if available
      if (
        uploadConfig.azureConfig?.enabled &&
        azureStorageService.generateDownloadUrl
      ) {
        return await azureStorageService.generateDownloadUrl(fileId)
      }

      throw new Error('No download service available')
    } catch (error) {
      console.error(
        `Failed to generate download URL for file ${fileId}:`,
        error
      )
      throw error
    }
  }
}

// Output service for form submissions with upload integration
const outputService = {
  submitForm: async (formId, formData) => {
    try {
      // Use the enhanced form submission service
      return await formSubmissionService.submit(formData, formId)
    } catch (error) {
      console.error(
        `Output service submission failed for form ${formId}:`,
        error
      )
      throw error
    }
  },

  submit: async (formData, formId) => {
    try {
      // Use the enhanced form submission service
      return await formSubmissionService.submit(formData, formId)
    } catch (error) {
      console.error(
        `Output service submission failed for form ${formId}:`,
        error
      )
      throw error
    }
  }
}

// Upload service specifically for forms engine
const uploadService = {
  uploadFile: async (file, metadata = {}) => {
    try {
      // Validate file
      const validation = await fileValidationService.validateFile(file)
      if (!validation.isValid) {
        throw new Error(
          `File validation failed: ${validation.errors.join(', ')}`
        )
      }

      // Upload via CDP uploader
      return await cdpUploaderService.uploadFile({
        file: file.stream || file,
        metadata: {
          originalName: file.originalname || file.filename || file.name,
          contentType: file.mimetype || file.type || 'application/octet-stream',
          size: file.size || file.length || 0,
          ...metadata,
          uploadedAt: new Date().toISOString()
        }
      })
    } catch (error) {
      console.error('Upload service failed:', error)
      throw error
    }
  },

  getUploadStatus: async (uploadId) => {
    return await cdpUploaderService.getUploadStatus(uploadId)
  },

  generateDownloadUrl: async (fileId) => {
    return await formSubmissionService.generateDownloadUrl(fileId)
  },

  deleteFile: async (fileId) => {
    return await formSubmissionService.deleteFile(fileId)
  },

  validateFile: async (file) => {
    return await fileValidationService.validateFile(file)
  },

  getConfig: () => {
    return uploadConfig.getFormsEngineConfig()
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
  userService,
  uploadService
}
