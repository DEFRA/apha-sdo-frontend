import { uploadConfig } from '../../../config/upload-config.js'

export const azureStorageService = {
  async uploadFile(uploadId, file, metadata = {}) {
    if (!uploadConfig.azureConfig.enabled) {
      throw new Error('Azure Blob Storage is not enabled')
    }

    try {
      const blobServiceClient = await uploadConfig.getAzureBlobClient()
      const containerClient = blobServiceClient.getContainerClient(
        uploadConfig.azureConfig.containerName
      )

      await containerClient.createIfNotExists({
        access: 'private'
      })

      const blobName = `${uploadId}/${metadata.originalName || file.originalname || file.hapi?.filename || 'unnamed-file'}`
      const blockBlobClient = containerClient.getBlockBlobClient(blobName)

      let buffer
      if (Buffer.isBuffer(file)) {
        buffer = file
      } else if (file.buffer && Buffer.isBuffer(file.buffer)) {
        buffer = file.buffer
      } else if (file._data && Buffer.isBuffer(file._data)) {
        buffer = file._data
      } else if (file.stream || typeof file.on === 'function') {
        buffer = await this.streamToBuffer(file.stream || file)
      } else {
        throw new Error('Invalid file input type')
      }

      // Determine content type
      const contentType =
        metadata.contentType ||
        file.mimetype ||
        file.hapi?.headers?.['content-type'] ||
        'application/octet-stream'

      // Upload with metadata
      const uploadOptions = {
        blobHTTPHeaders: {
          blobContentType: contentType
        },
        metadata: {
          uploadId,
          originalName:
            metadata.originalName ||
            file.originalname ||
            file.hapi?.filename ||
            'unnamed-file',
          uploadedAt: new Date().toISOString(),
          uploadedBy: metadata.uploadedBy || 'system',
          type: metadata.type || 'file',
          ...metadata
        }
      }

      const uploadResponse = await blockBlobClient.upload(
        buffer,
        buffer.length,
        uploadOptions
      )

      return {
        success: true,
        uploadId,
        blobName,
        url: blockBlobClient.url,
        etag: uploadResponse.etag,
        lastModified: uploadResponse.lastModified,
        size: buffer.length,
        contentType
      }
    } catch (error) {
      throw new Error(`Azure upload failed: ${error.message}`)
    }
  },

  /**
   * Download file from Azure Blob Storage
   */
  async downloadFile(uploadId, filename) {
    if (!uploadConfig.azureConfig.enabled) {
      throw new Error('Azure Blob Storage is not enabled')
    }

    try {
      const blobServiceClient = await uploadConfig.getAzureBlobClient()
      const containerClient = blobServiceClient.getContainerClient(
        uploadConfig.azureConfig.containerName
      )
      const blobName = `${uploadId}/${filename}`
      const blockBlobClient = containerClient.getBlockBlobClient(blobName)

      const downloadResponse = await blockBlobClient.download()

      return {
        success: true,
        stream: downloadResponse.readableStreamBody,
        contentType: downloadResponse.contentType,
        contentLength: downloadResponse.contentLength,
        lastModified: downloadResponse.lastModified,
        metadata: downloadResponse.metadata
      }
    } catch (error) {
      if (error.statusCode === 404) {
        return { success: false, error: 'File not found' }
      }
      throw new Error(`Azure download failed: ${error.message}`)
    }
  },

  /**
   * Generate SAS URL for direct access
   */
  async generateSasUrl(uploadId, filename, permissions = 'r', expiryHours = 1) {
    if (!uploadConfig.azureConfig.enabled) {
      throw new Error('Azure Blob Storage is not enabled')
    }

    try {
      const blobServiceClient = await uploadConfig.getAzureBlobClient()
      const containerClient = blobServiceClient.getContainerClient(
        uploadConfig.azureConfig.containerName
      )
      const blobName = `${uploadId}/${filename}`
      const blockBlobClient = containerClient.getBlockBlobClient(blobName)

      // Check if blob exists
      const exists = await blockBlobClient.exists()
      if (!exists) {
        throw new Error('File not found')
      }

      // Generate SAS URL
      const expiryDate = new Date()
      expiryDate.setHours(expiryDate.getHours() + expiryHours)

      const sasUrl = await blockBlobClient.generateSasUrl({
        permissions,
        expiresOn: expiryDate
      })

      return {
        success: true,
        sasUrl,
        expiresOn: expiryDate
      }
    } catch (error) {
      throw new Error(`SAS URL generation failed: ${error.message}`)
    }
  },

  /**
   * List files in Azure container
   */
  async listFiles(prefix = '') {
    if (!uploadConfig.azureConfig.enabled) {
      throw new Error('Azure Blob Storage is not enabled')
    }

    try {
      const blobServiceClient = await uploadConfig.getAzureBlobClient()
      const containerClient = blobServiceClient.getContainerClient(
        uploadConfig.azureConfig.containerName
      )

      const files = []
      const options = prefix ? { prefix } : {}

      for await (const blob of containerClient.listBlobsFlat(options)) {
        files.push({
          name: blob.name,
          size: blob.properties.contentLength,
          lastModified: blob.properties.lastModified,
          contentType: blob.properties.contentType,
          etag: blob.properties.etag,
          metadata: blob.metadata
        })
      }

      return {
        success: true,
        files,
        count: files.length
      }
    } catch (error) {
      throw new Error(`List files failed: ${error.message}`)
    }
  },

  /**
   * Delete file from Azure Blob Storage
   */
  async deleteFile(uploadId, filename) {
    if (!uploadConfig.azureConfig.enabled) {
      throw new Error('Azure Blob Storage is not enabled')
    }

    try {
      const blobServiceClient = await uploadConfig.getAzureBlobClient()
      const containerClient = blobServiceClient.getContainerClient(
        uploadConfig.azureConfig.containerName
      )
      const blobName = `${uploadId}/${filename}`
      const blockBlobClient = containerClient.getBlockBlobClient(blobName)

      const deleteResponse = await blockBlobClient.deleteIfExists()

      return {
        success: deleteResponse.succeeded,
        deleted: deleteResponse.succeeded
      }
    } catch (error) {
      throw new Error(`Azure delete failed: ${error.message}`)
    }
  },

  /**
   * Get container statistics
   */
  async getContainerStats() {
    if (!uploadConfig.azureConfig.enabled) {
      throw new Error('Azure Blob Storage is not enabled')
    }

    try {
      const blobServiceClient = await uploadConfig.getAzureBlobClient()
      const containerClient = blobServiceClient.getContainerClient(
        uploadConfig.azureConfig.containerName
      )

      let totalSize = 0
      let totalFiles = 0

      for await (const blob of containerClient.listBlobsFlat()) {
        totalFiles++
        totalSize += blob.properties.contentLength || 0
      }

      return {
        success: true,
        containerName: uploadConfig.azureConfig.containerName,
        totalFiles,
        totalSize,
        totalSizeFormatted: this.formatBytes(totalSize)
      }
    } catch (error) {
      throw new Error(`Get container stats failed: ${error.message}`)
    }
  },

  /**
   * Process files in background (for virus scanning, format conversion, etc.)
   */
  async processFileInBackground(uploadId, filename, processingType = 'scan') {
    if (!uploadConfig.azureConfig.backgroundProcessing) {
      return { success: false, message: 'Background processing is disabled' }
    }

    // This would typically integrate with Azure Functions, Logic Apps, or Service Bus
    // For now, we'll simulate background processing
    setTimeout(async () => {
      try {
        // Simulate processing
        const blobServiceClient = await uploadConfig.getAzureBlobClient()
        const containerClient = blobServiceClient.getContainerClient(
          uploadConfig.azureConfig.containerName
        )
        const blobName = `${uploadId}/${filename}`
        const blockBlobClient = containerClient.getBlockBlobClient(blobName)

        // Update metadata to mark as processed
        const properties = await blockBlobClient.getProperties()
        await blockBlobClient.setMetadata({
          ...properties.metadata,
          processed: 'true',
          processedAt: new Date().toISOString(),
          processingType
        })
      } catch (error) {
        console.error('Background processing failed:', error)
      }
    }, 1000) // Process after 1 second

    return {
      success: true,
      message: 'Background processing started',
      processingType,
      estimatedCompletionTime: '1-2 minutes'
    }
  },

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
  },

  /**
   * Format bytes for human reading
   */
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes'

    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']

    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
  }
}
