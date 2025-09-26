import {
  describe,
  test,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll
} from 'vitest'
import { redisUploadStore } from '../../src/server/services/redis-upload-store.js'

/**
 * Redis Migration Integration Tests
 *
 * These tests validate the Redis integration migration for upload tracking,
 * focusing on core Redis operations, fallback behavior, and data integrity.
 */
describe('Redis Migration Integration Tests', () => {
  // Store original Redis client state for restoration
  let originalRedisClient
  let originalRedisAvailable

  beforeAll(() => {
    // Store original Redis state for restoration
    originalRedisClient = redisUploadStore.redisClient
    originalRedisAvailable = redisUploadStore.redisAvailable
  })

  beforeEach(() => {
    // Reset Redis store to known state
    redisUploadStore.fallbackStore.clear()
    redisUploadStore.redisAvailable = true

    // Mock Redis client for testing
    redisUploadStore.redisClient = {
      setex: vi.fn().mockResolvedValue('OK'),
      set: vi.fn().mockResolvedValue('OK'),
      get: vi.fn().mockResolvedValue(null),
      del: vi.fn().mockResolvedValue(1),
      exists: vi.fn().mockResolvedValue(1),
      keys: vi.fn().mockResolvedValue([]),
      mget: vi.fn().mockResolvedValue([]),
      ttl: vi.fn().mockResolvedValue(3600),
      on: vi.fn(),
      quit: vi.fn().mockResolvedValue('OK')
    }
  })

  afterEach(() => {
    // Clean up test data
    redisUploadStore.fallbackStore.clear()
  })

  afterAll(() => {
    // Restore original Redis state
    redisUploadStore.redisClient = originalRedisClient
    redisUploadStore.redisAvailable = originalRedisAvailable
  })

  describe('Core Redis Operations', () => {
    test('should store upload data with TTL in Redis', async () => {
      const uploadId = 'test-upload-001'
      const uploadData = {
        uploadId,
        filename: 'test.xlsx',
        status: 'uploaded',
        virusScanStatus: 'pending',
        s3Key: 'uploads/test.xlsx',
        uploadedAt: new Date().toISOString()
      }

      const success = await redisUploadStore.setUpload(
        uploadId,
        uploadData,
        3600
      )

      expect(success).toBe(true)
      expect(redisUploadStore.redisClient.setex).toHaveBeenCalledWith(
        'uploads:test-upload-001',
        3600,
        expect.any(String)
      )

      // Verify the data was serialized correctly
      const serializedData = redisUploadStore.redisClient.setex.mock.calls[0][2]
      const parsedData = JSON.parse(serializedData)
      expect(parsedData).toEqual(
        expect.objectContaining({
          uploadId,
          filename: 'test.xlsx',
          status: 'uploaded',
          createdAt: expect.any(String),
          updatedAt: expect.any(String)
        })
      )
    })

    test('should retrieve upload data from Redis', async () => {
      const uploadId = 'test-retrieve-002'
      const storedData = {
        uploadId,
        filename: 'retrieve.xlsx',
        status: 'completed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      redisUploadStore.redisClient.get.mockResolvedValue(
        JSON.stringify(storedData)
      )

      const retrieved = await redisUploadStore.getUpload(uploadId)

      expect(redisUploadStore.redisClient.get).toHaveBeenCalledWith(
        'uploads:test-retrieve-002'
      )
      expect(retrieved).toEqual(
        expect.objectContaining({
          uploadId,
          filename: 'retrieve.xlsx',
          status: 'completed'
        })
      )
    })

    test('should update existing upload data preserving TTL', async () => {
      const uploadId = 'test-update-003'
      const existingData = {
        uploadId,
        filename: 'update.xlsx',
        status: 'uploaded',
        createdAt: new Date().toISOString()
      }

      // Mock existing data retrieval
      redisUploadStore.redisClient.get.mockResolvedValue(
        JSON.stringify(existingData)
      )
      redisUploadStore.redisClient.ttl.mockResolvedValue(1800) // 30 minutes remaining

      const updates = {
        status: 'completed',
        virusScanStatus: 'clean'
      }

      await redisUploadStore.updateUpload(uploadId, updates)

      // Should preserve remaining TTL
      expect(redisUploadStore.redisClient.setex).toHaveBeenCalledWith(
        'uploads:test-update-003',
        1800,
        expect.any(String)
      )

      // Verify updated data
      const serializedData = redisUploadStore.redisClient.setex.mock.calls[0][2]
      const parsedData = JSON.parse(serializedData)
      expect(parsedData).toEqual(
        expect.objectContaining({
          uploadId,
          status: 'completed',
          virusScanStatus: 'clean',
          updatedAt: expect.any(String)
        })
      )
    })

    test('should delete upload data from Redis', async () => {
      const uploadId = 'test-delete-004'

      const deleted = await redisUploadStore.deleteUpload(uploadId)

      expect(deleted).toBe(true)
      expect(redisUploadStore.redisClient.del).toHaveBeenCalledWith(
        'uploads:test-delete-004'
      )
    })

    test('should check if upload exists in Redis', async () => {
      const uploadId = 'test-exists-005'

      redisUploadStore.redisClient.exists.mockResolvedValue(1)

      const exists = await redisUploadStore.existsUpload(uploadId)

      expect(exists).toBe(true)
      expect(redisUploadStore.redisClient.exists).toHaveBeenCalledWith(
        'uploads:test-exists-005'
      )
    })
  })

  describe('Fallback Behavior When Redis is Unavailable', () => {
    beforeEach(() => {
      // Simulate Redis unavailability
      redisUploadStore.redisAvailable = false
      redisUploadStore.redisClient = null
    })

    test('should use fallback storage when Redis is unavailable', async () => {
      const uploadId = 'fallback-test-006'
      const uploadData = {
        uploadId,
        filename: 'fallback.xlsx',
        status: 'uploaded',
        uploadedAt: new Date().toISOString()
      }

      // Store should succeed using fallback
      const success = await redisUploadStore.setUpload(
        uploadId,
        uploadData,
        3600
      )
      expect(success).toBe(true)

      // Verify it's in fallback store
      expect(
        redisUploadStore.fallbackStore.has('uploads:fallback-test-006')
      ).toBe(true)

      // Retrieve should work from fallback
      const retrieved = await redisUploadStore.getUpload(uploadId)
      expect(retrieved).toEqual(
        expect.objectContaining({
          uploadId,
          filename: 'fallback.xlsx',
          status: 'uploaded'
        })
      )
    })

    test('should maintain data integrity during Redis outages', async () => {
      const uploads = [
        { uploadId: 'integrity-1', filename: 'file1.xlsx', status: 'uploaded' },
        {
          uploadId: 'integrity-2',
          filename: 'file2.xlsx',
          status: 'completed'
        },
        { uploadId: 'integrity-3', filename: 'file3.csv', status: 'processing' }
      ]

      // Store all uploads in fallback
      for (const upload of uploads) {
        await redisUploadStore.setUpload(upload.uploadId, upload)
      }

      // Verify all uploads are retrievable
      for (const upload of uploads) {
        const retrieved = await redisUploadStore.getUpload(upload.uploadId)
        expect(retrieved).toEqual(
          expect.objectContaining({
            uploadId: upload.uploadId,
            filename: upload.filename,
            status: upload.status
          })
        )
      }

      // Verify stats show fallback usage
      const stats = await redisUploadStore.getStats()
      expect(stats.redisAvailable).toBe(false)
      expect(stats.fallbackStoreSize).toBe(3)
    })

    test('should handle graceful transition back to Redis', async () => {
      const uploadId = 'transition-test-007'
      const uploadData = {
        uploadId,
        filename: 'transition.xlsx',
        status: 'uploaded'
      }

      // Store in fallback while Redis is down
      await redisUploadStore.setUpload(uploadId, uploadData)
      expect(
        redisUploadStore.fallbackStore.has('uploads:transition-test-007')
      ).toBe(true)

      // Simulate Redis coming back online
      redisUploadStore.redisAvailable = true
      redisUploadStore.redisClient = {
        setex: vi.fn().mockResolvedValue('OK'),
        set: vi.fn().mockResolvedValue('OK'),
        get: vi.fn().mockResolvedValue(null),
        ttl: vi.fn().mockResolvedValue(-1),
        on: vi.fn()
      }

      // New operations should prefer Redis again
      const newUploadId = 'transition-new-008'
      const newUploadData = {
        uploadId: newUploadId,
        filename: 'new.xlsx',
        status: 'uploaded'
      }

      await redisUploadStore.setUpload(newUploadId, newUploadData)

      // Should have tried Redis first
      expect(redisUploadStore.redisClient.setex).toHaveBeenCalled()
    })
  })

  describe('TTL Expiration Behavior', () => {
    test('should respect TTL settings for upload data', async () => {
      const uploadId = 'ttl-test-009'
      const uploadData = {
        uploadId,
        filename: 'ttl.xlsx',
        status: 'uploaded'
      }

      const customTTL = 7200 // 2 hours
      await redisUploadStore.setUpload(uploadId, uploadData, customTTL)

      expect(redisUploadStore.redisClient.setex).toHaveBeenCalledWith(
        'uploads:ttl-test-009',
        customTTL,
        expect.any(String)
      )
    })

    test('should remove expired entries from fallback store', async () => {
      // Use fallback store
      redisUploadStore.redisAvailable = false

      const uploadId = 'expired-test-010'
      const uploadData = {
        uploadId,
        filename: 'expired.xlsx',
        status: 'uploaded'
      }

      // Store with very short TTL
      await redisUploadStore.setUpload(uploadId, uploadData, 0.1)

      // Verify it's stored
      expect(
        redisUploadStore.fallbackStore.has('uploads:expired-test-010')
      ).toBe(true)

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Should return null for expired entry
      const retrieved = await redisUploadStore.getUpload(uploadId)
      expect(retrieved).toBeNull()

      // Entry should be removed from fallback store
      expect(
        redisUploadStore.fallbackStore.has('uploads:expired-test-010')
      ).toBe(false)
    })

    test('should clean up expired uploads from fallback storage', async () => {
      // Use fallback store
      redisUploadStore.redisAvailable = false

      // Create mix of expired and valid uploads by manually setting entries
      const now = Date.now()
      const uploads = [
        { uploadId: 'cleanup-1', filename: 'file1.xlsx', expired: true },
        { uploadId: 'cleanup-2', filename: 'file2.xlsx', expired: false },
        { uploadId: 'cleanup-3', filename: 'file3.xlsx', expired: true },
        { uploadId: 'cleanup-4', filename: 'file4.xlsx', expired: false }
      ]

      // Manually create entries with appropriate expiration times
      for (const upload of uploads) {
        const key = `uploads:${upload.uploadId}`
        const expiresAt = upload.expired ? now - 1000 : now + 3600000 // Expired vs 1 hour from now

        redisUploadStore.fallbackStore.set(key, {
          data: JSON.stringify({
            uploadId: upload.uploadId,
            filename: upload.filename,
            status: 'uploaded'
          }),
          expiresAt
        })
      }

      // Run cleanup
      const cleanedCount = await redisUploadStore.cleanupExpiredUploads()

      expect(cleanedCount).toBe(2) // Should clean up the 2 expired entries
      expect(redisUploadStore.fallbackStore.size).toBe(2) // Should have 2 valid entries remaining
    })
  })

  describe('Data Serialization and Deserialization', () => {
    test('should correctly serialize and deserialize complex upload data', async () => {
      const uploadId = 'serialize-test-011'
      const complexData = {
        uploadId,
        filename: 'complex.xlsx',
        status: 'completed',
        metadata: {
          submissionId: 'sub-123',
          formType: 'bat-rabies',
          customFields: {
            region: 'North West',
            priority: 'high',
            tags: ['urgent', 'resubmission']
          }
        },
        timestamps: {
          uploadedAt: '2023-12-01T10:00:00.000Z',
          processedAt: '2023-12-01T10:05:00.000Z'
        },
        fileSize: 2048576,
        checksum: 'sha256:abcd1234'
      }

      // Use fallback store for direct verification
      redisUploadStore.redisAvailable = false

      // Store complex data
      await redisUploadStore.setUpload(uploadId, complexData)

      // Retrieve and verify
      const retrieved = await redisUploadStore.getUpload(uploadId)

      expect(retrieved).toEqual(
        expect.objectContaining({
          uploadId,
          filename: 'complex.xlsx',
          status: 'completed',
          metadata: expect.objectContaining({
            submissionId: 'sub-123',
            customFields: expect.objectContaining({
              tags: ['urgent', 'resubmission']
            })
          }),
          timestamps: expect.objectContaining({
            uploadedAt: '2023-12-01T10:00:00.000Z'
          }),
          fileSize: 2048576
        })
      )
    })

    test('should handle JSON serialization errors gracefully', async () => {
      const uploadId = 'serialize-error-012'

      // Create data with circular reference
      const circularData = {
        uploadId,
        filename: 'circular.xlsx'
      }
      circularData.self = circularData // Circular reference

      // Should throw error for invalid data
      await expect(
        redisUploadStore.setUpload(uploadId, circularData)
      ).rejects.toThrow('Failed to serialize upload data')
    })

    test('should handle JSON deserialization errors gracefully', async () => {
      const uploadId = 'deserialize-error-013'
      const key = `uploads:${uploadId}`

      // Use fallback store and manually insert invalid JSON
      redisUploadStore.redisAvailable = false
      redisUploadStore.fallbackStore.set(key, {
        data: '{ invalid json: }',
        expiresAt: null
      })

      // Should return null for invalid JSON
      const result = await redisUploadStore.getUpload(uploadId)
      expect(result).toBeNull()
    })

    test('should preserve data types during round-trip', async () => {
      const uploadId = 'types-test-014'
      const typedData = {
        uploadId,
        filename: 'types.xlsx',
        status: 'uploaded',
        fileSize: 1024,
        isValid: true,
        errorCount: 0,
        uploadedAt: new Date().toISOString(),
        tags: ['test', 'validation'],
        metadata: null,
        scores: { quality: 95.5, performance: 87.2 }
      }

      // Use fallback for direct data verification
      redisUploadStore.redisAvailable = false

      await redisUploadStore.setUpload(uploadId, typedData)
      const retrieved = await redisUploadStore.getUpload(uploadId)

      // Verify all data types are preserved
      expect(retrieved.fileSize).toBe(1024)
      expect(retrieved.isValid).toBe(true)
      expect(retrieved.errorCount).toBe(0)
      expect(retrieved.tags).toEqual(['test', 'validation'])
      expect(retrieved.metadata).toBeNull()
      expect(retrieved.scores).toEqual({ quality: 95.5, performance: 87.2 })
      expect(typeof retrieved.uploadedAt).toBe('string')
    })
  })

  describe('Concurrent Operations', () => {
    test('should handle concurrent Redis operations', async () => {
      const uploads = Array.from({ length: 5 }, (_, i) => ({
        uploadId: `concurrent-${i}`,
        filename: `file-${i}.xlsx`,
        status: 'uploaded'
      }))

      // Mock Redis get to return the stored data for each upload
      redisUploadStore.redisClient.get.mockImplementation((key) => {
        const uploadId = key.replace('uploads:', '')
        const upload = uploads.find((u) => u.uploadId === uploadId)
        if (upload) {
          return Promise.resolve(
            JSON.stringify({
              ...upload,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            })
          )
        }
        return Promise.resolve(null)
      })

      // Perform concurrent operations
      const storePromises = uploads.map((upload) =>
        redisUploadStore.setUpload(upload.uploadId, upload)
      )

      const results = await Promise.all(storePromises)

      // All operations should succeed
      expect(results.every((result) => result === true)).toBe(true)

      // Verify all uploads are retrievable
      const retrievePromises = uploads.map((upload) =>
        redisUploadStore.getUpload(upload.uploadId)
      )

      const retrievedUploads = await Promise.all(retrievePromises)

      retrievedUploads.forEach((retrieved, index) => {
        expect(retrieved).toEqual(
          expect.objectContaining({
            uploadId: uploads[index].uploadId,
            filename: uploads[index].filename
          })
        )
      })
    })

    test('should maintain data consistency during concurrent updates', async () => {
      const uploadId = 'concurrent-consistency-015'
      const baseData = {
        uploadId,
        filename: 'concurrent.xlsx',
        status: 'uploaded'
      }

      // Reset the mock call count before this test
      redisUploadStore.redisClient.setex.mockClear()

      // Mock get method to return the base data for all concurrent reads
      redisUploadStore.redisClient.get.mockResolvedValue(
        JSON.stringify({
          ...baseData,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
      )

      // Create multiple concurrent update operations (don't store initial upload to avoid extra call)
      const updatePromises = [
        redisUploadStore.updateUpload(uploadId, { status: 'processing' }),
        redisUploadStore.updateUpload(uploadId, { virusScanStatus: 'clean' }),
        redisUploadStore.updateUpload(uploadId, { status: 'completed' }),
        redisUploadStore.updateUpload(uploadId, { azureTransferred: true })
      ]

      // Wait for all updates
      const updateResults = await Promise.allSettled(updatePromises)

      // All updates should succeed
      updateResults.forEach((result) => {
        expect(result.status).toBe('fulfilled')
      })

      // Verify Redis was called for each update (should be exactly 4)
      expect(redisUploadStore.redisClient.setex).toHaveBeenCalledTimes(4)
    })
  })

  describe('Error Handling and Recovery', () => {
    test('should handle Redis connection interruption during operations', async () => {
      const uploadId = 'connection-test-016'
      const uploadData = {
        uploadId,
        filename: 'connection.xlsx',
        status: 'uploaded'
      }

      // Mock Redis failure
      redisUploadStore.redisClient.setex.mockRejectedValue(
        new Error('ECONNRESET')
      )

      // Operation should fallback to memory store
      const success = await redisUploadStore.setUpload(uploadId, uploadData)
      expect(success).toBe(true)

      // Should be stored in fallback
      expect(
        redisUploadStore.fallbackStore.has('uploads:connection-test-016')
      ).toBe(true)
      expect(redisUploadStore.redisAvailable).toBe(false)
    })

    test('should provide meaningful error messages for invalid input', async () => {
      // Test invalid upload ID
      await expect(redisUploadStore.setUpload('', {})).rejects.toThrow(
        'Upload ID must be a non-empty string'
      )

      await expect(redisUploadStore.setUpload(null, {})).rejects.toThrow(
        'Upload ID must be a non-empty string'
      )

      // Test invalid upload data
      await expect(redisUploadStore.setUpload('test', null)).rejects.toThrow(
        'Upload data must be an object'
      )

      await expect(
        redisUploadStore.setUpload('test', 'invalid')
      ).rejects.toThrow('Upload data must be an object')
    })
  })

  describe('Backward Compatibility', () => {
    test('should handle legacy upload data format', async () => {
      const uploadId = 'legacy-test-017'

      // Simulate legacy data format stored in fallback
      const legacyData = {
        id: uploadId, // Old field name
        file_name: 'legacy.xlsx', // Old field name
        upload_status: 'complete', // Old field name
        created: '2023-11-01T10:00:00.000Z' // Old field name
      }

      // Use fallback store
      redisUploadStore.redisAvailable = false
      const key = `uploads:${uploadId}`
      redisUploadStore.fallbackStore.set(key, {
        data: JSON.stringify(legacyData),
        expiresAt: null
      })

      const retrieved = await redisUploadStore.getUpload(uploadId)

      // Should handle legacy field names
      expect(retrieved).toEqual(
        expect.objectContaining({
          id: uploadId,
          file_name: 'legacy.xlsx',
          upload_status: 'complete',
          created: '2023-11-01T10:00:00.000Z'
        })
      )
    })

    test('should migrate old storage format to new Redis format seamlessly', async () => {
      const uploadId = 'migration-compat-018'

      // Simulate old in-memory storage format
      const oldFormatData = {
        upload_id: uploadId,
        original_filename: 'old-format.xlsx',
        content_type:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        file_size: 2048,
        upload_timestamp: 1701425400000,
        processing_status: 'pending'
      }

      // Use fallback store and manually set legacy format
      redisUploadStore.redisAvailable = false
      const key = `uploads:${uploadId}`
      redisUploadStore.fallbackStore.set(key, {
        data: JSON.stringify(oldFormatData),
        expiresAt: null
      })

      // Mock the get method to return legacy data, then update it
      redisUploadStore.redisClient = {
        setex: vi.fn().mockResolvedValue('OK'),
        get: vi.fn().mockResolvedValue(
          JSON.stringify({
            ...oldFormatData,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          })
        ),
        ttl: vi.fn().mockResolvedValue(-1),
        on: vi.fn()
      }
      redisUploadStore.redisAvailable = true

      // Migration: Update to new format should work
      const newFormatUpdate = {
        status: 'completed',
        virusScanStatus: 'clean',
        azureTransferred: true
      }

      await redisUploadStore.updateUpload(uploadId, newFormatUpdate)

      // Should have preserved legacy fields and added new ones
      const serializedData = redisUploadStore.redisClient.setex.mock.calls[0][2]
      const migrated = JSON.parse(serializedData)

      expect(migrated).toEqual(
        expect.objectContaining({
          // Legacy fields preserved
          upload_id: uploadId,
          original_filename: 'old-format.xlsx',
          upload_timestamp: 1701425400000,
          // New fields added
          status: 'completed',
          virusScanStatus: 'clean',
          azureTransferred: true,
          updatedAt: expect.any(String)
        })
      )
    })
  })

  describe('Store Statistics and Management', () => {
    test('should provide accurate store statistics', async () => {
      // Setup mixed Redis and fallback data
      redisUploadStore.redisClient.keys.mockResolvedValue([
        'uploads:redis-1',
        'uploads:redis-2'
      ])

      // Add some fallback entries
      redisUploadStore.fallbackStore.set('uploads:fallback-1', {
        data: '{}',
        expiresAt: null
      })
      redisUploadStore.fallbackStore.set('uploads:fallback-2', {
        data: '{}',
        expiresAt: null
      })

      const stats = await redisUploadStore.getStats()

      expect(stats).toEqual({
        redisAvailable: true,
        fallbackStoreSize: 2,
        redisKeyCount: 2,
        defaultTTL: 24 * 60 * 60 // 24 hours
      })
    })

    test('should handle store closure gracefully', async () => {
      await redisUploadStore.close()

      expect(redisUploadStore.redisClient.quit).toHaveBeenCalled()
      expect(redisUploadStore.fallbackStore.size).toBe(0)
    })
  })
})
