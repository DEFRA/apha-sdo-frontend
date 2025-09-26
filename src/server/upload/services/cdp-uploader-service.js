import { uploadConfig } from '../../../config/upload-config.js'
import { v4 as uuidv4 } from 'uuid'
import { redisUploadStore } from '../../services/redis-upload-store.js'

export class CdpUploaderService {
  async uploadFile({ file, metadata }) {
    const config = uploadConfig.getCdpUploaderConfig()
    const uploadId = uuidv4()

    try {
      const formData = new FormData()

      const buffer = await this.streamToBuffer(file)
      const blob = new Blob([buffer], { type: metadata.contentType })

      formData.append('file', blob, metadata.originalName)
      formData.append('uploadId', uploadId)
      formData.append('bucket', config.bucket)
      formData.append('prefix', config.stagingPrefix)

      // Add metadata
      if (metadata) {
        formData.append('metadata', JSON.stringify(metadata))
      }

      // Make request to CDP uploader
      const response = await fetch(`${config.url}/upload`, {
        method: 'POST',
        body: formData,
        headers: {
          Authorization: `Bearer ${config.callbackAuthToken}`,
          'X-Request-ID': uploadId
        },
        timeout: config.timeout
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
          `CDP uploader failed: ${response.status} - ${errorText}`
        )
      }

      const result = await response.json()

      // Store upload information including file buffer for direct Azure upload
      const uploadData = {
        uploadId,
        filename: metadata.originalName,
        contentType: metadata.contentType,
        size: buffer.length,
        status: 'uploaded',
        uploadedAt: new Date().toISOString(),
        s3Key:
          result.s3Key ||
          `${config.stagingPrefix}${uploadId}/${metadata.originalName}`,
        bucket: config.bucket,
        virusScanStatus: 'pending',
        // Store file buffer as base64 to avoid S3 download later
        fileBuffer: buffer.toString('base64')
      }

      await redisUploadStore.setUpload(uploadId, uploadData)

      return {
        uploadId,
        filename: metadata.originalName,
        size: buffer.length,
        s3Key:
          result.s3Key ||
          `${config.stagingPrefix}${uploadId}/${metadata.originalName}`
      }
    } catch (error) {
      // Store failed upload for tracking
      const failedData = {
        uploadId,
        filename: metadata.originalName,
        status: 'failed',
        error: error.message,
        uploadedAt: new Date().toISOString()
      }

      await redisUploadStore.setUpload(uploadId, failedData)

      throw new Error(`Upload failed: ${error.message}`)
    }
  }

  /**
   * Get upload status
   */
  async getUploadStatus(uploadId) {
    return await redisUploadStore.getUpload(uploadId)
  }

  /**
   * Poll CDP uploader for virus scan status
   */
  async pollVirusScanStatus(uploadId, maxAttempts = 60, intervalMs = 2000) {
    const config = uploadConfig.getCdpUploaderConfig()
    let attempts = 0

    return new Promise((resolve, reject) => {
      const pollInterval = setInterval(async () => {
        attempts++

        try {
          // Check local Redis/memory first
          const localUpload = await redisUploadStore.getUpload(uploadId)

          if (localUpload?.virusScanStatus === 'clean') {
            clearInterval(pollInterval)
            return resolve({ status: 'clean', uploadId, localUpload })
          }

          if (
            localUpload?.virusScanStatus === 'infected' ||
            localUpload?.virusScanStatus === 'quarantined'
          ) {
            clearInterval(pollInterval)
            return resolve({ status: 'infected', uploadId, localUpload })
          }

          // Try to get status from CDP uploader API
          try {
            const response = await fetch(`${config.url}/status/${uploadId}`, {
              headers: {
                Authorization: `Bearer ${config.callbackAuthToken}`
              },
              timeout: 5000
            })

            if (response.ok) {
              const cdpStatus = await response.json()

              // Update local status
              if (cdpStatus.virusScanStatus) {
                await redisUploadStore.updateUpload(uploadId, {
                  virusScanStatus: cdpStatus.virusScanStatus,
                  status: cdpStatus.status
                })

                if (cdpStatus.virusScanStatus === 'clean') {
                  clearInterval(pollInterval)
                  return resolve({ status: 'clean', uploadId, localUpload })
                }

                if (
                  cdpStatus.virusScanStatus === 'infected' ||
                  cdpStatus.virusScanStatus === 'quarantined'
                ) {
                  clearInterval(pollInterval)
                  return resolve({ status: 'infected', uploadId, localUpload })
                }
              }
            }
          } catch (fetchError) {
            // CDP status check failed, continue polling
            console.warn('CDP status check failed, will retry', {
              uploadId,
              error: fetchError.message
            })
          }

          // Check max attempts
          if (attempts >= maxAttempts) {
            clearInterval(pollInterval)
            reject(
              new Error(
                `Virus scan polling timed out after ${maxAttempts} attempts`
              )
            )
          }
        } catch (error) {
          clearInterval(pollInterval)
          reject(error)
        }
      }, intervalMs)
    })
  }

  /**
   * Process upload with virus scanning and direct Azure transfer
   */
  async processUploadWithAzureTransfer(uploadId, azureStorageService) {
    try {
      // Poll for virus scan completion
      const scanResult = await this.pollVirusScanStatus(uploadId)

      if (scanResult.status !== 'clean') {
        throw new Error(`File failed virus scan: ${scanResult.status}`)
      }

      // Get the upload data with file buffer
      const uploadData =
        scanResult.localUpload || (await redisUploadStore.getUpload(uploadId))

      if (!uploadData?.fileBuffer) {
        throw new Error('File buffer not found for upload')
      }

      // Convert base64 back to buffer
      const fileBuffer = Buffer.from(uploadData.fileBuffer, 'base64')

      // Upload directly to Azure
      const azureResult = await azureStorageService.uploadFile(
        uploadId,
        {
          buffer: fileBuffer,
          originalname: uploadData.filename,
          mimetype: uploadData.contentType,
          size: fileBuffer.length
        },
        {
          virusScanStatus: 'clean',
          transferredAt: new Date().toISOString()
        }
      )

      // Update upload status and clear buffer
      await redisUploadStore.updateUpload(uploadId, {
        status: 'completed',
        azureTransferred: true,
        azureBlobName: azureResult.blobName,
        azureUrl: azureResult.url,
        fileBuffer: null // Clear buffer to save memory
      })

      return {
        success: true,
        uploadId,
        azureResult
      }
    } catch (error) {
      await redisUploadStore.updateUpload(uploadId, {
        status: 'transfer_failed',
        transferError: error.message,
        fileBuffer: null // Clear buffer on failure
      })

      throw error
    }
  }

  /**
   * Handle callback from CDP uploader
   */
  async handleCallback(payload) {
    const { uploadId, status, s3Key, error, virusScanStatus } = payload

    // Update upload status
    const existingUpload = await redisUploadStore.getUpload(uploadId)
    if (existingUpload) {
      await redisUploadStore.setUpload(uploadId, {
        ...existingUpload,
        status: virusScanStatus === 'clean' ? 'virus_scan_complete' : status,
        virusScanStatus: virusScanStatus || status,
        s3Key: s3Key || existingUpload.s3Key,
        processedAt: new Date().toISOString(),
        error: error || existingUpload.error
      })
    } else {
      // Store callback data for unknown upload (recovery scenario)
      await redisUploadStore.setUpload(uploadId, {
        uploadId,
        status: virusScanStatus === 'clean' ? 'virus_scan_complete' : status,
        virusScanStatus: virusScanStatus || status,
        s3Key,
        error,
        processedAt: new Date().toISOString(),
        source: 'callback'
      })
    }
  }

  /**
   * Retry failed upload
   */
  async retryUpload(uploadId, originalFile, metadata) {
    const config = uploadConfig.getCdpUploaderConfig()
    let attempts = 0

    while (attempts < config.retryAttempts) {
      try {
        attempts++
        const result = await this.uploadFile({ file: originalFile, metadata })
        return result
      } catch (error) {
        if (attempts >= config.retryAttempts) {
          throw error
        }

        // Wait before retry (exponential backoff)
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempts))
      }
    }
  }

  /**
   * Convert stream to buffer
   */
  async streamToBuffer(stream) {
    const chunks = []

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(chunk))
      stream.on('end', () => resolve(Buffer.concat(chunks)))
      stream.on('error', reject)
    })
  }

  /**
   * Get all uploads (for admin/monitoring)
   */
  async getAllUploads() {
    return await redisUploadStore.getAllUploads()
  }

  /**
   * Health check
   */
  async healthCheck() {
    const config = uploadConfig.getCdpUploaderConfig()

    try {
      const response = await fetch(`${config.url}/health`, {
        method: 'GET',
        timeout: 5000
      })

      return {
        healthy: response.ok,
        status: response.status,
        timestamp: new Date().toISOString()
      }
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }
    }
  }
}

// Export both the class and an instance for backward compatibility
export const cdpUploaderService = new CdpUploaderService()
