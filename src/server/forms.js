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
import { uploadConfig } from '../config/upload-config.js'
import { redisUploadStore } from './services/redis-upload-store.js'

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
      `Persisting ${files?.length || 0} files with retrieval key: ${persistedRetrievalKey}`
    )

    return Promise.resolve({
      success: true,
      persistedFiles: files?.length || 0,
      retrievalKey: persistedRetrievalKey
    })
  },

  uploadFile: async (file, formId) => {
    try {
      const originalFilename =
        file.originalname || file.filename || file.name || 'unnamed-file'
      const contentType =
        file.mimetype || file.type || 'application/octet-stream'

      // Convert stream to buffer once for both uploads (CDP and Azure)
      let fileBuffer
      if (Buffer.isBuffer(file)) {
        fileBuffer = file
      } else if (file.buffer && Buffer.isBuffer(file.buffer)) {
        fileBuffer = file.buffer
      } else if (file._data && Buffer.isBuffer(file._data)) {
        fileBuffer = file._data
      } else if (file.stream || typeof file.on === 'function') {
        // Convert stream to buffer before any uploads
        const stream = file.stream || file
        const chunks = []
        await new Promise((resolve, reject) => {
          stream.on('data', (chunk) => chunks.push(chunk))
          stream.on('end', () => resolve())
          stream.on('error', reject)
        })
        fileBuffer = Buffer.concat(chunks)
      } else {
        throw new Error('Invalid file input type')
      }

      // Upload using CDP uploader service with buffered file
      const uploadResult = await cdpUploaderService.uploadFile({
        file: fileBuffer,
        metadata: {
          originalName: originalFilename,
          contentType,
          size: fileBuffer.length,
          formId,
          uploadedAt: new Date().toISOString()
        }
      })

      // Also upload to Azure if configured
      if (uploadConfig.azureConfig?.enabled) {
        try {
          // Create file object with buffer for Azure upload
          const azureFile = {
            buffer: fileBuffer,
            originalname: originalFilename,
            mimetype: contentType,
            size: fileBuffer.length
          }

          await azureStorageService.uploadFile(
            uploadResult.uploadId,
            azureFile,
            {
              originalName: originalFilename,
              type: 'spreadsheet'
            }
          )

          console.info('File uploaded to both CDP and Azure successfully', {
            uploadId: uploadResult.uploadId,
            filename: originalFilename,
            formId: formId || 'unknown'
          })
        } catch (azureError) {
          console.error('Azure upload failed but CDP upload succeeded:', {
            uploadId: uploadResult.uploadId,
            filename: originalFilename,
            formId: formId || 'unknown',
            error: azureError.message
          })
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
      console.error(`File upload failed for form ${formId || 'unknown'}:`, {
        message: error.message,
        formId: formId || 'unknown',
        fileName:
          file?.originalname || file?.filename || file?.name || 'unknown'
      })
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
        const originalFilename =
          file.originalname || file.filename || file.name || 'submission'
        const filenameBase = originalFilename.replace(/\.[^/.]+$/, '')
        // const timestamp = Date.now()
        // const uniqueBase = `${timestamp}_${filenameBase}`

        // Convert stream to buffer once for both uploads
        let fileBuffer
        if (Buffer.isBuffer(file)) {
          fileBuffer = file
        } else if (file.buffer && Buffer.isBuffer(file.buffer)) {
          fileBuffer = file.buffer
        } else if (file._data && Buffer.isBuffer(file._data)) {
          fileBuffer = file._data
        } else if (file.stream || typeof file.on === 'function') {
          // Convert stream to buffer
          const stream = file.stream || file
          const chunks = []
          await new Promise((resolve, reject) => {
            stream.on('data', (chunk) => chunks.push(chunk))
            stream.on('end', () => resolve())
            stream.on('error', reject)
          })
          fileBuffer = Buffer.concat(chunks)
        } else {
          throw new Error('Invalid file input type')
        }

        // Upload spreadsheet via CDP uploader using the buffer
        const uploadResult = await cdpUploaderService.uploadFile({
          file: fileBuffer,
          metadata: {
            originalName: originalFilename,
            contentType:
              file.mimetype || file.type || 'application/octet-stream',
            size: fileBuffer.length,
            formId,
            type: 'spreadsheet',
            uploadedAt: jsonData.submittedAt
          }
        })

        // If Azure is enabled, upload both spreadsheet and JSON
        // NOTE: This uploads immediately, before virus scanning
        // The callback handler will also upload after virus scan passes
        if (uploadConfig.azureConfig?.enabled) {
          try {
            // Create and upload JSON file first (no virus scan needed for JSON)
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

            console.log('JSON uploaded to Azure immediately', {
              uploadId: uploadResult.uploadId,
              json: jsonFilename,
              spreadsheet: originalFilename,
              filenameBase,
              note: 'Spreadsheet will be uploaded after virus scan via callback'
            })

            // Store JSON filename and spreadsheet name in metadata for later reference
            // This ensures both files have the same base name
            await redisUploadStore.updateUpload(uploadResult.uploadId, {
              jsonFilename,
              originalSpreadsheetName: originalFilename,
              filenameBase
            })
          } catch (azureError) {
            console.warn('Azure JSON upload failed:', azureError.message)
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
        `File upload with form data failed for form ${formId || 'unknown'}:`,
        {
          message: error.message,
          formId: formId || 'unknown',
          hasFile: !!file,
          fileName: file?.originalname || file?.filename || file?.name || 'none'
        }
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
      console.error(`File deletion failed for file ${fileId || 'unknown'}:`, {
        message: error.message,
        fileId: fileId || 'unknown'
      })
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

        console.log(
          `Form submission for form ${formId || 'unknown'} with uploaded files`
        )
        return {
          id: `submission-${Date.now()}`,
          formId,
          submittedAt: new Date().toISOString(),
          status: 'submitted',
          data: formData
        }
      }
    } catch (error) {
      console.error(`Form submission failed for form ${formId || 'unknown'}:`, {
        message: error.message,
        formId: formId || 'unknown',
        hasFile: !!(
          formData?.file ||
          formData?.files ||
          formData?.supportingDocuments
        )
      })
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
        `Failed to generate download URL for file ${fileId || 'unknown'}:`,
        {
          message: error.message,
          fileId: fileId || 'unknown'
        }
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
        `Output service submission failed for form ${formId || 'unknown'}:`,
        {
          message: error.message,
          formId: formId || 'unknown'
        }
      )
      throw error
    }
  },

  submit: async (submission) => {
    let formId = 'unknown'
    let formData = null

    try {
      // Validate submission parameter
      if (!submission) {
        throw new Error(
          'Submission parameter is required but was null or undefined'
        )
      }

      // Check if submission is actually a Hapi request object
      // The forms-engine-plugin may pass the request object directly
      const isHapiRequest = !!(
        submission._core &&
        submission._route &&
        submission.headers &&
        submission.method &&
        submission.path
      )

      if (isHapiRequest) {
        console.log('Detected Hapi request object in outputService.submit')

        // Extract form data from request payload
        formData = submission.payload || submission.yar?.get('formData') || {}

        // Try to extract form ID from various locations in the request
        // 1. Check params first (most reliable)
        if (submission.params?.slug) {
          const slug = submission.params.slug
          console.log(`Found slug in params: ${slug}`)

          if (slug === 'bat-rabies') {
            formId = 'b1a2c3d4-e5f6-7890-1234-567890fedcba'
          } else if (slug === 'example-form') {
            formId = exampleMetadata.id
          } else if (slug === 'contact-form') {
            formId = contactMetadata.id
          }
        }

        // 2. Check if form ID is in params directly
        if (!formId || formId === 'unknown') {
          if (submission.params?.formId) {
            formId = submission.params.formId
          }
        }

        // 3. Check the route path
        if (!formId || formId === 'unknown') {
          const path = submission.path || submission.url?.pathname || ''
          if (path.includes('bat-rabies')) {
            formId = 'b1a2c3d4-e5f6-7890-1234-567890fedcba'
          } else if (path.includes('example-form')) {
            formId = exampleMetadata.id
          } else if (path.includes('contact-form')) {
            formId = contactMetadata.id
          }
        }

        // 4. Check if formMetadata is stored in session/yar
        if (!formId || formId === 'unknown') {
          const formMetadata = submission.yar?.get('formMetadata')
          if (formMetadata?.id) {
            formId = formMetadata.id
          }
        }

        // 5. Check payload for form metadata
        if (!formId || formId === 'unknown') {
          if (formData.formId) {
            formId = formData.formId
          } else if (formData.metadata?.id) {
            formId = formData.metadata.id
          }
        }

        console.log(
          `Extracted from Hapi request - Form ID: ${formId}, Has data: ${!!formData}`
        )
      } else {
        // Handle normal submission object (backward compatibility)
        console.log('Processing standard submission object')

        // Enhanced debugging to understand submission structure
        console.log('Submission object structure:', {
          hasMetadata: !!submission.metadata,
          hasFormId: !!submission.formId,
          hasId: !!submission.id,
          hasForm: !!submission.form,
          hasRequest: !!submission.request,
          hasFormMetadata: !!submission.formMetadata,
          hasSlug: !!submission.slug,
          hasFormSlug: !!submission.formSlug,
          topLevelKeys: Object.keys(submission).slice(0, 10)
        })

        // Try multiple extraction strategies to find the form ID
        formId = null

        // Check for bat-rabies form specifically
        if (
          submission.slug === 'bat-rabies' ||
          submission.formSlug === 'bat-rabies'
        ) {
          formId = 'b1a2c3d4-e5f6-7890-1234-567890fedcba'
        } else if (submission.formMetadata?.id) {
          formId = submission.formMetadata.id
        } else if (submission.metadata?.id) {
          formId = submission.metadata.id
        } else if (submission.formId) {
          formId = submission.formId
        } else if (submission.id) {
          formId = submission.id
        } else if (submission.form?.id) {
          formId = submission.form.id
        } else if (submission.request?.params?.formId) {
          formId = submission.request.params.formId
        } else if (submission.request?.params?.slug) {
          // Try to get form ID from slug
          const slug = submission.request.params.slug
          if (slug === 'bat-rabies') {
            formId = 'b1a2c3d4-e5f6-7890-1234-567890fedcba'
          } else if (slug === 'example-form') {
            formId = exampleMetadata.id
          } else if (slug === 'contact-form') {
            formId = contactMetadata.id
          }
        }

        formData = submission.data || submission.payload || submission
      }

      console.log(
        `Output service submit called - Form ID: ${formId || 'NOT_FOUND'}, Has submission data: ${!!formData}`
      )

      if (!formId || formId === 'unknown' || formId === 'unknown-form') {
        console.warn(
          'Form ID could not be extracted from submission. Available properties:',
          Object.keys(submission)
            .filter((key) => key !== 'data' && key !== 'payload')
            .join(', ')
        )

        // Last resort: check URL/path patterns from multiple sources
        const urlsToCheck = [
          submission.url,
          submission.path,
          submission.request?.url,
          submission.request?.path
        ]

        let formDetected = false
        for (const url of urlsToCheck) {
          if (typeof url === 'string' && url.includes('bat-rabies')) {
            console.log(
              'Detected bat-rabies form from URL/path, using hardcoded form ID'
            )
            formId = 'b1a2c3d4-e5f6-7890-1234-567890fedcba'
            formDetected = true
            break
          }
        }

        if (!formDetected) {
          // Use fallback ID
          formId = 'unknown-form'
        }
      }

      return await formSubmissionService.submit(formData, formId)
    } catch (error) {
      console.error(
        `Output service submission failed for form: ${formId || 'unknown'}`,
        {
          message: error.message,
          stack: error.stack?.split('\n')[0] // Only log first line of stack
        }
      )
      throw error
    }
  }
}

// Upload service specifically for forms engine
const uploadService = {
  uploadFile: async (file, metadata = {}) => {
    try {
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
      console.error('Upload service failed:', {
        message: error.message,
        fileName:
          file?.originalname || file?.filename || file?.name || 'unknown'
      })
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
