import { buildRedisClient } from '../common/helpers/redis-client.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { config } from '../../config/config.js'

/**
 * Redis Upload Store Service
 *
 * Provides persistent storage for upload tracking with automatic fallback to in-memory Map
 * when Redis is unavailable. Handles JSON serialization, TTL management, and proper
 * key namespacing for upload operations.
 */
class RedisUploadStore {
  constructor() {
    this.logger = createLogger()
    this.keyNamespace = 'uploads'
    this.defaultTTL = 24 * 60 * 60 // 24 hours in seconds
    this.fallbackStore = new Map() // In-memory fallback when Redis is unavailable
    this.redisAvailable = true

    try {
      this.redisClient = buildRedisClient(config.get('redis'))
      this._setupRedisEventHandlers()
    } catch (error) {
      this.logger.warn(
        'Redis client initialization failed, using fallback storage',
        { error: error.message }
      )
      this.redisAvailable = false
    }
  }

  /**
   * Setup Redis event handlers for connection monitoring
   * @private
   */
  _setupRedisEventHandlers() {
    if (!this.redisClient) return

    this.redisClient.on('error', (error) => {
      this.logger.error(
        'Redis connection error, switching to fallback storage',
        { error: error.message }
      )
      this.redisAvailable = false
    })

    this.redisClient.on('connect', () => {
      this.logger.info('Redis connected successfully')
      this.redisAvailable = true
    })

    this.redisClient.on('ready', () => {
      this.logger.info('Redis client ready')
      this.redisAvailable = true
    })
  }

  /**
   * Generate namespaced key for upload operations
   * @param {string} uploadId - The upload identifier
   * @returns {string} Namespaced Redis key
   * @private
   */
  _getKey(uploadId) {
    return `${this.keyNamespace}:${uploadId}`
  }

  /**
   * Safely parse JSON with error handling
   * @param {string} data - JSON string to parse
   * @returns {object|null} Parsed object or null if parsing fails
   * @private
   */
  _safeJsonParse(data) {
    try {
      return JSON.parse(data)
    } catch (error) {
      this.logger.warn('Failed to parse JSON data', {
        error: error.message,
        data
      })
      return null
    }
  }

  /**
   * Safely stringify JSON with error handling
   * @param {object} data - Object to stringify
   * @returns {string|null} JSON string or null if stringify fails
   * @private
   */
  _safeJsonStringify(data) {
    try {
      return JSON.stringify(data)
    } catch (error) {
      this.logger.warn('Failed to stringify JSON data', {
        error: error.message
      })
      return null
    }
  }

  /**
   * Store upload data with optional TTL
   * @param {string} uploadId - Unique upload identifier
   * @param {object} data - Upload data to store
   * @param {number} [ttl] - Time to live in seconds (defaults to 24 hours)
   * @returns {Promise<boolean>} Success status
   */
  async setUpload(uploadId, data, ttl = this.defaultTTL) {
    if (!uploadId || typeof uploadId !== 'string') {
      throw new Error('Upload ID must be a non-empty string')
    }

    if (!data || typeof data !== 'object') {
      throw new Error('Upload data must be an object')
    }

    const key = this._getKey(uploadId)
    const serializedData = this._safeJsonStringify({
      ...data,
      uploadId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })

    if (!serializedData) {
      throw new Error('Failed to serialize upload data')
    }

    // Try Redis first, fallback to memory if unavailable
    if (this.redisAvailable && this.redisClient) {
      try {
        if (ttl > 0) {
          await this.redisClient.setex(key, ttl, serializedData)
        } else {
          await this.redisClient.set(key, serializedData)
        }

        this.logger.debug('Upload data stored in Redis', { uploadId, ttl })
        return true
      } catch (error) {
        this.logger.warn('Redis operation failed, using fallback storage', {
          error: error.message,
          uploadId
        })
        this.redisAvailable = false
      }
    }

    // Fallback to in-memory storage
    this.fallbackStore.set(key, {
      data: serializedData,
      expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : null
    })

    this.logger.debug('Upload data stored in fallback storage', {
      uploadId,
      ttl
    })
    return true
  }

  /**
   * Retrieve upload data by ID
   * @param {string} uploadId - Upload identifier
   * @returns {Promise<object|null>} Upload data or null if not found
   */
  async getUpload(uploadId) {
    if (!uploadId || typeof uploadId !== 'string') {
      throw new Error('Upload ID must be a non-empty string')
    }

    const key = this._getKey(uploadId)

    // Try Redis first
    if (this.redisAvailable && this.redisClient) {
      try {
        const data = await this.redisClient.get(key)
        if (data) {
          const parsedData = this._safeJsonParse(data)
          this.logger.debug('Upload data retrieved from Redis', { uploadId })
          return parsedData
        }
      } catch (error) {
        this.logger.warn(
          'Redis get operation failed, trying fallback storage',
          { error: error.message, uploadId }
        )
        this.redisAvailable = false
      }
    }

    // Try fallback storage
    const fallbackEntry = this.fallbackStore.get(key)
    if (fallbackEntry) {
      // Check if expired
      if (fallbackEntry.expiresAt && Date.now() > fallbackEntry.expiresAt) {
        this.fallbackStore.delete(key)
        this.logger.debug('Expired upload data removed from fallback storage', {
          uploadId
        })
        return null
      }

      const parsedData = this._safeJsonParse(fallbackEntry.data)
      this.logger.debug('Upload data retrieved from fallback storage', {
        uploadId
      })
      return parsedData
    }

    this.logger.debug('Upload data not found', { uploadId })
    return null
  }

  /**
   * Update existing upload data
   * @param {string} uploadId - Upload identifier
   * @param {object} updates - Data updates to apply
   * @returns {Promise<boolean>} Success status
   */
  async updateUpload(uploadId, updates) {
    if (!uploadId || typeof uploadId !== 'string') {
      throw new Error('Upload ID must be a non-empty string')
    }

    if (!updates || typeof updates !== 'object') {
      throw new Error('Updates must be an object')
    }

    const existingData = await this.getUpload(uploadId)
    if (!existingData) {
      throw new Error(`Upload with ID ${uploadId} not found`)
    }

    const updatedData = {
      ...existingData,
      ...updates,
      updatedAt: new Date().toISOString()
    }

    // Preserve original TTL by checking when it expires
    let remainingTTL = this.defaultTTL
    const key = this._getKey(uploadId)

    if (this.redisAvailable && this.redisClient) {
      try {
        remainingTTL = await this.redisClient.ttl(key)
        if (remainingTTL === -1) remainingTTL = this.defaultTTL // No expiry set
        if (remainingTTL === -2) remainingTTL = this.defaultTTL // Key doesn't exist
      } catch (error) {
        this.logger.warn('Failed to get TTL, using default', {
          error: error.message
        })
      }
    }

    return await this.setUpload(uploadId, updatedData, remainingTTL)
  }

  /**
   * Delete upload data
   * @param {string} uploadId - Upload identifier
   * @returns {Promise<boolean>} Success status (true if deleted or didn't exist)
   */
  async deleteUpload(uploadId) {
    if (!uploadId || typeof uploadId !== 'string') {
      throw new Error('Upload ID must be a non-empty string')
    }

    const key = this._getKey(uploadId)
    let deleted = false

    // Try Redis first
    if (this.redisAvailable && this.redisClient) {
      try {
        const result = await this.redisClient.del(key)
        deleted = result > 0
        this.logger.debug('Upload data deleted from Redis', {
          uploadId,
          deleted
        })
      } catch (error) {
        this.logger.warn(
          'Redis delete operation failed, trying fallback storage',
          { error: error.message, uploadId }
        )
        this.redisAvailable = false
      }
    }

    // Try fallback storage
    if (this.fallbackStore.has(key)) {
      this.fallbackStore.delete(key)
      deleted = true
      this.logger.debug('Upload data deleted from fallback storage', {
        uploadId
      })
    }

    return deleted
  }

  /**
   * Check if upload exists
   * @param {string} uploadId - Upload identifier
   * @returns {Promise<boolean>} Whether upload exists
   */
  async existsUpload(uploadId) {
    if (!uploadId || typeof uploadId !== 'string') {
      throw new Error('Upload ID must be a non-empty string')
    }

    const key = this._getKey(uploadId)

    // Try Redis first
    if (this.redisAvailable && this.redisClient) {
      try {
        const exists = await this.redisClient.exists(key)
        if (exists) {
          this.logger.debug('Upload exists check (Redis)', {
            uploadId,
            exists: true
          })
          return true
        }
      } catch (error) {
        this.logger.warn(
          'Redis exists operation failed, trying fallback storage',
          { error: error.message, uploadId }
        )
        this.redisAvailable = false
      }
    }

    // Check fallback storage
    const fallbackEntry = this.fallbackStore.get(key)
    if (fallbackEntry) {
      // Check if expired
      if (fallbackEntry.expiresAt && Date.now() > fallbackEntry.expiresAt) {
        this.fallbackStore.delete(key)
        this.logger.debug(
          'Upload exists check (fallback) - expired and removed',
          { uploadId }
        )
        return false
      }
      this.logger.debug('Upload exists check (fallback)', {
        uploadId,
        exists: true
      })
      return true
    }

    this.logger.debug('Upload exists check - not found', { uploadId })
    return false
  }

  /**
   * Get all uploads (use with caution - can be memory intensive)
   * @param {number} [limit=100] - Maximum number of uploads to return
   * @returns {Promise<Array>} Array of upload objects
   */
  async getAllUploads(limit = 100) {
    const uploads = []
    const pattern = `${this.keyNamespace}:*`

    // Try Redis first
    if (this.redisAvailable && this.redisClient) {
      try {
        const keys = await this.redisClient.keys(pattern)
        const limitedKeys = keys.slice(0, limit)

        if (limitedKeys.length > 0) {
          const values = await this.redisClient.mget(...limitedKeys)
          for (const value of values) {
            if (value) {
              const parsedData = this._safeJsonParse(value)
              if (parsedData) {
                uploads.push(parsedData)
              }
            }
          }
        }

        this.logger.debug('Retrieved uploads from Redis', {
          count: uploads.length
        })
        return uploads
      } catch (error) {
        this.logger.warn(
          'Redis scan operation failed, trying fallback storage',
          { error: error.message }
        )
        this.redisAvailable = false
      }
    }

    // Fallback storage
    let count = 0
    for (const [key, entry] of this.fallbackStore.entries()) {
      if (!key.startsWith(`${this.keyNamespace}:`)) continue
      if (count >= limit) break

      // Check if expired
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        this.fallbackStore.delete(key)
        continue
      }

      const parsedData = this._safeJsonParse(entry.data)
      if (parsedData) {
        uploads.push(parsedData)
        count++
      }
    }

    this.logger.debug('Retrieved uploads from fallback storage', {
      count: uploads.length
    })
    return uploads
  }

  /**
   * Clean up expired uploads from fallback storage
   * @returns {Promise<number>} Number of uploads cleaned up
   */
  async cleanupExpiredUploads() {
    let cleanedCount = 0

    // For fallback storage, manually check and remove expired entries
    const now = Date.now()
    for (const [key, entry] of this.fallbackStore.entries()) {
      if (!key.startsWith(`${this.keyNamespace}:`)) continue

      if (entry.expiresAt && now > entry.expiresAt) {
        this.fallbackStore.delete(key)
        cleanedCount++
      }
    }

    if (cleanedCount > 0) {
      this.logger.info('Cleaned up expired uploads from fallback storage', {
        count: cleanedCount
      })
    }

    // Redis handles TTL automatically, but we can get stats
    if (this.redisAvailable && this.redisClient) {
      try {
        // This is just informational - Redis handles cleanup automatically
        const keys = await this.redisClient.keys(`${this.keyNamespace}:*`)
        this.logger.debug('Current uploads in Redis', { count: keys.length })
      } catch (error) {
        this.logger.warn('Failed to get Redis upload count during cleanup', {
          error: error.message
        })
      }
    }

    return cleanedCount
  }

  /**
   * Get store statistics
   * @returns {Promise<object>} Store statistics
   */
  async getStats() {
    const stats = {
      redisAvailable: this.redisAvailable,
      fallbackStoreSize: this.fallbackStore.size,
      redisKeyCount: 0,
      defaultTTL: this.defaultTTL
    }

    if (this.redisAvailable && this.redisClient) {
      try {
        const keys = await this.redisClient.keys(`${this.keyNamespace}:*`)
        stats.redisKeyCount = keys.length
      } catch (error) {
        this.logger.warn('Failed to get Redis stats', { error: error.message })
      }
    }

    return stats
  }

  /**
   * Close Redis connection (for graceful shutdown)
   * @returns {Promise<void>}
   */
  async close() {
    if (this.redisClient) {
      try {
        await this.redisClient.quit()
        this.logger.info('Redis connection closed')
      } catch (error) {
        this.logger.warn('Error closing Redis connection', {
          error: error.message
        })
      }
    }

    this.fallbackStore.clear()
    this.logger.info('Redis upload store closed')
  }
}

// Create and export singleton instance
const redisUploadStore = new RedisUploadStore()

export { redisUploadStore, RedisUploadStore }
