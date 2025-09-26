import { redisUploadStore } from '../services/redis-upload-store.js'
import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()
let isInitialized = false

export const initializeUploadPipeline = async (serverLogger = logger) => {
  if (isInitialized) return

  try {
    await redisUploadStore.checkHealth()
    serverLogger.info('Upload pipeline initialized with Redis')
  } catch (error) {
    serverLogger.warn('Upload pipeline using in-memory storage')
  }

  isInitialized = true
}

export const getUploadPipelineHealth = async () => {
  const redisHealth = await redisUploadStore.checkHealth()
  const activeUploads = await redisUploadStore.getAllUploads()

  return {
    healthy: true,
    storage: redisHealth ? 'redis' : 'memory',
    activeUploads: activeUploads.length,
    initialized: isInitialized
  }
}

export const triggerProcessing = async () => {
  const uploads = await redisUploadStore.getAllUploads()
  const pending = uploads.filter((u) => u.status === 'pending')

  for (const upload of pending) {
    if (upload.uploadedAt < Date.now() - 3600000) {
      await redisUploadStore.setUpload(upload.uploadId, {
        ...upload,
        status: 'timeout'
      })
    }
  }

  return { processed: pending.length }
}

export const retryFailedTransfers = async () => {
  const uploads = await redisUploadStore.getAllUploads()
  const failed = uploads.filter(
    (u) => u.status === 'error' || u.status === 'timeout'
  )

  for (const upload of failed) {
    await redisUploadStore.setUpload(upload.uploadId, {
      ...upload,
      status: 'retrying',
      retryAt: Date.now()
    })
  }

  return { retrying: failed.length }
}
