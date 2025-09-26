import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RedisUploadStore, redisUploadStore } from './redis-upload-store.js'

// Mock dependencies
vi.mock('../common/helpers/redis-client.js', () => ({
  buildRedisClient: vi.fn(() => ({
    setex: vi.fn().mockResolvedValue('OK'),
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
    exists: vi.fn().mockResolvedValue(0),
    keys: vi.fn().mockResolvedValue([]),
    mget: vi.fn().mockResolvedValue([]),
    ttl: vi.fn().mockResolvedValue(-1),
    quit: vi.fn().mockResolvedValue('OK'),
    on: vi.fn()
  }))
}))

vi.mock('../common/helpers/logging/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }))
}))

vi.mock('../../config/config.js', () => ({
  config: {
    get: vi.fn().mockReturnValue({
      host: '127.0.0.1',
      username: '',
      password: '',
      keyPrefix: 'test:',
      useSingleInstanceCache: true,
      useTLS: false
    })
  }
}))

describe('RedisUploadStore', () => {
  let store
  let mockRedisClient

  beforeEach(() => {
    // Create fresh instance for each test
    store = new RedisUploadStore()
    mockRedisClient = store.redisClient

    // Clear any existing data
    store.fallbackStore.clear()
  })

  afterEach(async () => {
    await store.close()
  })

  describe('constructor', () => {
    it('should initialize with correct default values', () => {
      expect(store.keyNamespace).toBe('uploads')
      expect(store.defaultTTL).toBe(24 * 60 * 60) // 24 hours
      expect(store.redisAvailable).toBe(true)
      expect(store.fallbackStore).toBeInstanceOf(Map)
    })

    it('should handle Redis client initialization failure gracefully', async () => {
      const { buildRedisClient } = await import(
        '../common/helpers/redis-client.js'
      )
      buildRedisClient.mockImplementationOnce(() => {
        throw new Error('Redis connection failed')
      })

      const storeWithFailure = new RedisUploadStore()
      expect(storeWithFailure.redisAvailable).toBe(false)
    })
  })

  describe('setUpload', () => {
    it('should store upload data with default TTL', async () => {
      const uploadId = 'test-upload-1'
      const uploadData = { filename: 'test.xlsx', size: 1024 }

      mockRedisClient.setex.mockResolvedValueOnce('OK')

      const result = await store.setUpload(uploadId, uploadData)

      expect(result).toBe(true)
      expect(mockRedisClient.setex).toHaveBeenCalledWith(
        'uploads:test-upload-1',
        store.defaultTTL,
        expect.stringContaining('"filename":"test.xlsx"')
      )
    })

    it('should store upload data with custom TTL', async () => {
      const uploadId = 'test-upload-2'
      const uploadData = { filename: 'test2.xlsx', size: 2048 }
      const customTTL = 3600 // 1 hour

      mockRedisClient.setex.mockResolvedValueOnce('OK')

      const result = await store.setUpload(uploadId, uploadData, customTTL)

      expect(result).toBe(true)
      expect(mockRedisClient.setex).toHaveBeenCalledWith(
        'uploads:test-upload-2',
        customTTL,
        expect.stringContaining('"filename":"test2.xlsx"')
      )
    })

    it('should fall back to memory storage when Redis fails', async () => {
      const uploadId = 'test-upload-3'
      const uploadData = { filename: 'test3.xlsx', size: 4096 }

      mockRedisClient.setex.mockRejectedValueOnce(new Error('Redis error'))

      const result = await store.setUpload(uploadId, uploadData)

      expect(result).toBe(true)
      expect(store.fallbackStore.has('uploads:test-upload-3')).toBe(true)
      expect(store.redisAvailable).toBe(false)
    })

    it('should throw error for invalid uploadId', async () => {
      await expect(store.setUpload('', {})).rejects.toThrow(
        'Upload ID must be a non-empty string'
      )
      await expect(store.setUpload(null, {})).rejects.toThrow(
        'Upload ID must be a non-empty string'
      )
      await expect(store.setUpload(123, {})).rejects.toThrow(
        'Upload ID must be a non-empty string'
      )
    })

    it('should throw error for invalid data', async () => {
      await expect(store.setUpload('test', null)).rejects.toThrow(
        'Upload data must be an object'
      )
      await expect(store.setUpload('test', 'string')).rejects.toThrow(
        'Upload data must be an object'
      )
      await expect(store.setUpload('test', 123)).rejects.toThrow(
        'Upload data must be an object'
      )
    })
  })

  describe('getUpload', () => {
    it('should retrieve upload data from Redis', async () => {
      const uploadId = 'test-upload-4'
      const uploadData = {
        filename: 'test4.xlsx',
        size: 1024,
        uploadId,
        createdAt: new Date().toISOString()
      }

      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(uploadData))

      const result = await store.getUpload(uploadId)

      expect(result).toEqual(uploadData)
      expect(mockRedisClient.get).toHaveBeenCalledWith('uploads:test-upload-4')
    })

    it('should retrieve upload data from fallback storage', async () => {
      const uploadId = 'test-upload-5'
      const uploadData = { filename: 'test5.xlsx', size: 2048 }

      // Set up fallback storage
      store.redisAvailable = false
      await store.setUpload(uploadId, uploadData)

      const result = await store.getUpload(uploadId)

      expect(result.filename).toBe('test5.xlsx')
      expect(result.uploadId).toBe(uploadId)
    })

    it('should return null for non-existent upload', async () => {
      mockRedisClient.get.mockResolvedValueOnce(null)

      const result = await store.getUpload('non-existent')

      expect(result).toBeNull()
    })

    it('should handle expired entries in fallback storage', async () => {
      const uploadId = 'test-upload-expired'
      const key = store._getKey(uploadId)

      // Manually add expired entry
      store.fallbackStore.set(key, {
        data: JSON.stringify({ filename: 'expired.xlsx' }),
        expiresAt: Date.now() - 1000 // Expired 1 second ago
      })

      const result = await store.getUpload(uploadId)

      expect(result).toBeNull()
      expect(store.fallbackStore.has(key)).toBe(false)
    })

    it('should throw error for invalid uploadId', async () => {
      await expect(store.getUpload('')).rejects.toThrow(
        'Upload ID must be a non-empty string'
      )
      await expect(store.getUpload(null)).rejects.toThrow(
        'Upload ID must be a non-empty string'
      )
    })
  })

  describe('updateUpload', () => {
    it('should update existing upload data', async () => {
      const uploadId = 'test-upload-6'
      const originalData = {
        filename: 'original.xlsx',
        size: 1024,
        status: 'processing'
      }
      const updates = {
        status: 'completed',
        processedAt: new Date().toISOString()
      }

      // Mock existing data
      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(originalData))
      mockRedisClient.ttl.mockResolvedValueOnce(3600)
      mockRedisClient.setex.mockResolvedValueOnce('OK')

      const result = await store.updateUpload(uploadId, updates)

      expect(result).toBe(true)
      expect(mockRedisClient.setex).toHaveBeenCalledWith(
        'uploads:test-upload-6',
        3600,
        expect.stringContaining('"status":"completed"')
      )
    })

    it('should throw error for non-existent upload', async () => {
      mockRedisClient.get.mockResolvedValueOnce(null)

      await expect(
        store.updateUpload('non-existent', { status: 'completed' })
      ).rejects.toThrow('Upload with ID non-existent not found')
    })

    it('should throw error for invalid parameters', async () => {
      await expect(store.updateUpload('', {})).rejects.toThrow(
        'Upload ID must be a non-empty string'
      )
      await expect(store.updateUpload('test', null)).rejects.toThrow(
        'Updates must be an object'
      )
    })
  })

  describe('deleteUpload', () => {
    it('should delete upload from Redis', async () => {
      const uploadId = 'test-upload-7'

      mockRedisClient.del.mockResolvedValueOnce(1)

      const result = await store.deleteUpload(uploadId)

      expect(result).toBe(true)
      expect(mockRedisClient.del).toHaveBeenCalledWith('uploads:test-upload-7')
    })

    it('should delete upload from fallback storage', async () => {
      const uploadId = 'test-upload-8'
      const key = store._getKey(uploadId)

      store.fallbackStore.set(key, { data: '{}', expiresAt: null })
      store.redisAvailable = false

      const result = await store.deleteUpload(uploadId)

      expect(result).toBe(true)
      expect(store.fallbackStore.has(key)).toBe(false)
    })

    it('should return true even if upload does not exist', async () => {
      mockRedisClient.del.mockResolvedValueOnce(0)

      const result = await store.deleteUpload('non-existent')

      expect(result).toBe(false)
    })

    it('should throw error for invalid uploadId', async () => {
      await expect(store.deleteUpload('')).rejects.toThrow(
        'Upload ID must be a non-empty string'
      )
    })
  })

  describe('existsUpload', () => {
    it('should return true for existing upload in Redis', async () => {
      const uploadId = 'test-upload-9'

      mockRedisClient.exists.mockResolvedValueOnce(1)

      const result = await store.existsUpload(uploadId)

      expect(result).toBe(true)
    })

    it('should return true for existing upload in fallback storage', async () => {
      const uploadId = 'test-upload-10'
      const key = store._getKey(uploadId)

      store.fallbackStore.set(key, { data: '{}', expiresAt: null })
      store.redisAvailable = false

      const result = await store.existsUpload(uploadId)

      expect(result).toBe(true)
    })

    it('should return false for non-existent upload', async () => {
      mockRedisClient.exists.mockResolvedValueOnce(0)

      const result = await store.existsUpload('non-existent')

      expect(result).toBe(false)
    })
  })

  describe('getAllUploads', () => {
    it('should retrieve all uploads from Redis', async () => {
      const uploads = [
        { uploadId: 'upload-1', filename: 'file1.xlsx' },
        { uploadId: 'upload-2', filename: 'file2.xlsx' }
      ]

      mockRedisClient.keys.mockResolvedValueOnce([
        'uploads:upload-1',
        'uploads:upload-2'
      ])
      mockRedisClient.mget.mockResolvedValueOnce([
        JSON.stringify(uploads[0]),
        JSON.stringify(uploads[1])
      ])

      const result = await store.getAllUploads()

      expect(result).toHaveLength(2)
      expect(result[0].uploadId).toBe('upload-1')
      expect(result[1].uploadId).toBe('upload-2')
    })

    it('should respect limit parameter', async () => {
      const keys = Array.from({ length: 200 }, (_, i) => `uploads:upload-${i}`)
      mockRedisClient.keys.mockResolvedValueOnce(keys)
      mockRedisClient.mget.mockResolvedValueOnce(Array(50).fill('{}'))

      await store.getAllUploads(50)

      expect(mockRedisClient.mget).toHaveBeenCalledWith(...keys.slice(0, 50))
    })

    it('should retrieve uploads from fallback storage', async () => {
      store.redisAvailable = false
      const key1 = store._getKey('upload-1')
      const key2 = store._getKey('upload-2')

      store.fallbackStore.set(key1, {
        data: JSON.stringify({ uploadId: 'upload-1' }),
        expiresAt: null
      })
      store.fallbackStore.set(key2, {
        data: JSON.stringify({ uploadId: 'upload-2' }),
        expiresAt: null
      })

      const result = await store.getAllUploads()

      expect(result).toHaveLength(2)
    })
  })

  describe('cleanupExpiredUploads', () => {
    it('should clean up expired uploads from fallback storage', async () => {
      const expiredKey = store._getKey('expired-upload')
      const validKey = store._getKey('valid-upload')

      store.fallbackStore.set(expiredKey, {
        data: JSON.stringify({ uploadId: 'expired-upload' }),
        expiresAt: Date.now() - 1000
      })
      store.fallbackStore.set(validKey, {
        data: JSON.stringify({ uploadId: 'valid-upload' }),
        expiresAt: Date.now() + 10000
      })

      const cleanedCount = await store.cleanupExpiredUploads()

      expect(cleanedCount).toBe(1)
      expect(store.fallbackStore.has(expiredKey)).toBe(false)
      expect(store.fallbackStore.has(validKey)).toBe(true)
    })
  })

  describe('getStats', () => {
    it('should return store statistics', async () => {
      mockRedisClient.keys.mockResolvedValueOnce(['uploads:1', 'uploads:2'])

      const stats = await store.getStats()

      expect(stats).toHaveProperty('redisAvailable')
      expect(stats).toHaveProperty('fallbackStoreSize')
      expect(stats).toHaveProperty('redisKeyCount')
      expect(stats).toHaveProperty('defaultTTL')
      expect(stats.redisKeyCount).toBe(2)
    })
  })

  describe('close', () => {
    it('should close Redis connection and clear fallback store', async () => {
      store.fallbackStore.set('test', 'data')
      mockRedisClient.quit.mockResolvedValueOnce('OK')

      await store.close()

      expect(mockRedisClient.quit).toHaveBeenCalled()
      expect(store.fallbackStore.size).toBe(0)
    })
  })

  describe('singleton instance', () => {
    it('should export a singleton instance', () => {
      expect(redisUploadStore).toBeInstanceOf(RedisUploadStore)
    })
  })

  describe('private methods', () => {
    describe('_getKey', () => {
      it('should generate correct namespaced key', () => {
        const key = store._getKey('test-id')
        expect(key).toBe('uploads:test-id')
      })
    })

    describe('_safeJsonParse', () => {
      it('should parse valid JSON', () => {
        const result = store._safeJsonParse('{"test": "value"}')
        expect(result).toEqual({ test: 'value' })
      })

      it('should return null for invalid JSON', () => {
        const result = store._safeJsonParse('invalid json')
        expect(result).toBeNull()
      })
    })

    describe('_safeJsonStringify', () => {
      it('should stringify valid object', () => {
        const result = store._safeJsonStringify({ test: 'value' })
        expect(result).toBe('{"test":"value"}')
      })

      it('should return null for unstringifiable object', () => {
        const circular = {}
        circular.self = circular
        const result = store._safeJsonStringify(circular)
        expect(result).toBeNull()
      })
    })
  })
})
