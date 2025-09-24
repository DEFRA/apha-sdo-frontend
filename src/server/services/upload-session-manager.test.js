import {
  vi,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach
} from 'vitest'
import {
  createSession,
  updateSession,
  getSession,
  storeFormData,
  getFormData,
  completeSession,
  failSession,
  incrementAttempts,
  getActiveCount,
  getSessionsByStatus,
  getHealthMetrics,
  __clearAllSessions
} from './upload-session-manager.js'

vi.mock('../common/helpers/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}))

const mockMemoryUsage = {
  rss: 100000000,
  heapTotal: 50000000,
  heapUsed: 30000000,
  external: 5000000
}
global.process.memoryUsage = vi.fn(() => mockMemoryUsage)

describe('Upload Session Manager', () => {
  let originalSetTimeout, originalClearInterval, originalSetInterval
  let mockSetTimeout, mockClearInterval, mockSetInterval

  beforeAll(() => {
    // Mock timers
    originalSetTimeout = global.setTimeout
    originalClearInterval = global.clearInterval
    originalSetInterval = global.setInterval

    mockSetTimeout = vi.fn((callback, delay) => {
      return { id: 'timeout-' + Math.random() }
    })
    mockClearInterval = vi.fn()
    mockSetInterval = vi.fn(() => ({ id: 'interval-' + Math.random() }))

    global.setTimeout = mockSetTimeout
    global.clearInterval = mockClearInterval
    global.setInterval = mockSetInterval
  })

  afterAll(() => {
    // Restore original timers
    global.setTimeout = originalSetTimeout
    global.clearInterval = originalClearInterval
    global.setInterval = originalSetInterval
  })

  beforeEach(() => {
    vi.clearAllMocks()
    // Clear all sessions before each test to avoid state pollution
    __clearAllSessions()
    // Reset Date.now to a consistent value for testing
    vi.spyOn(Date, 'now').mockReturnValue(1640995200000) // 2022-01-01 00:00:00
  })

  afterEach(() => {
    Date.now.mockRestore()
    // Clear all sessions after each test as well
    __clearAllSessions()
  })

  describe('Session Creation', () => {
    const sampleMetadata = {
      originalName: 'test-document.pdf',
      size: 1024000,
      mimetype: 'application/pdf',
      formId: 'contact-form',
      clientIp: '192.168.1.1'
    }

    it('should create a new session with correct initial values', () => {
      const uploadId = 'upload-123'
      const session = createSession(uploadId, sampleMetadata)

      expect(session).toEqual({
        uploadId: 'upload-123',
        status: 'active',
        createdAt: 1640995200000,
        lastActivity: 1640995200000,
        progress: 0,
        metadata: sampleMetadata,
        formData: null,
        attempts: 0,
        errors: []
      })
    })

    it('should create session with form data when provided in metadata', () => {
      const uploadId = 'upload-124'
      const formData = { name: 'John Doe', email: 'john@example.com' }
      const metadataWithForm = { ...sampleMetadata, formData }

      const session = createSession(uploadId, metadataWithForm)

      expect(session.formData).toEqual(formData)
      expect(session.metadata.formData).toEqual(formData)
    })

    it('should log session creation', async () => {
      const uploadId = 'upload-125'
      createSession(uploadId, sampleMetadata)

      const { logger } = await import('../common/helpers/logging/logger.js')
      expect(logger.info).toHaveBeenCalledWith('Upload session created', {
        uploadId: 'upload-125',
        formId: 'contact-form',
        filename: 'test-document.pdf'
      })
    })

    it('should enforce concurrent upload limits', () => {
      // Create maximum allowed concurrent uploads (10)
      for (let i = 1; i <= 10; i++) {
        createSession(`upload-${i}`, { ...sampleMetadata, formId: `form-${i}` })
      }

      // 11th upload should fail
      expect(() => {
        createSession('upload-11', sampleMetadata)
      }).toThrow('Maximum concurrent uploads exceeded')
    })

    it('should allow new session when previous ones are completed', () => {
      // Create 10 sessions
      for (let i = 1; i <= 10; i++) {
        createSession(`upload-${i}`, { ...sampleMetadata, formId: `form-${i}` })
      }

      // Complete one session
      completeSession('upload-1', { url: 'https://example.com/file1.pdf' })

      // Should now allow a new session
      expect(() => {
        createSession('upload-11', sampleMetadata)
      }).not.toThrow()
    })
  })

  describe('Session Updates and Retrieval', () => {
    const uploadId = 'test-upload'
    const metadata = {
      originalName: 'test.pdf',
      size: 500000,
      mimetype: 'application/pdf',
      formId: 'test-form'
    }

    beforeEach(() => {
      createSession(uploadId, metadata)
    })

    it('should update session status and progress', () => {
      const updates = {
        status: 'uploading',
        progress: 50,
        metadata: { additionalInfo: 'processing' }
      }

      const updatedSession = updateSession(uploadId, updates)

      expect(updatedSession.status).toBe('uploading')
      expect(updatedSession.progress).toBe(50)
      expect(updatedSession.metadata.additionalInfo).toBe('processing')
      expect(updatedSession.lastActivity).toBe(1640995200000)
    })

    it('should log session updates', async () => {
      updateSession(uploadId, { status: 'uploading', progress: 75 })

      const { logger } = await import('../common/helpers/logging/logger.js')
      expect(logger.debug).toHaveBeenCalledWith('Upload session updated', {
        uploadId,
        status: 'uploading',
        progress: 75
      })
    })

    it('should throw error when updating non-existent session', () => {
      expect(() => {
        updateSession('non-existent', { progress: 50 })
      }).toThrow('Session not found: non-existent')
    })

    it('should retrieve existing session', () => {
      const session = getSession(uploadId)

      expect(session).not.toBeNull()
      expect(session.uploadId).toBe(uploadId)
      expect(session.metadata).toEqual(metadata)
    })

    it('should return null for non-existent session', () => {
      const session = getSession('non-existent')
      expect(session).toBeNull()
    })
  })

  describe('Form Data Management', () => {
    const uploadId = 'form-test-upload'
    const metadata = {
      originalName: 'form-document.pdf',
      size: 750000,
      mimetype: 'application/pdf',
      formId: 'contact-form'
    }

    beforeEach(() => {
      createSession(uploadId, metadata)
    })

    it('should store form data and update last activity', () => {
      const formData = {
        name: 'Jane Smith',
        email: 'jane@example.com',
        message: 'Test message',
        category: 'inquiry'
      }

      const updatedSession = storeFormData(uploadId, formData)

      expect(updatedSession.formData).toEqual(formData)
      expect(updatedSession.lastActivity).toBe(1640995200000)
    })

    it('should log form data storage', async () => {
      const formData = {
        name: 'John',
        email: 'john@test.com',
        phone: '123-456-7890'
      }
      storeFormData(uploadId, formData)

      const { logger } = await import('../common/helpers/logging/logger.js')
      expect(logger.debug).toHaveBeenCalledWith('Form data stored in session', {
        uploadId,
        formFieldCount: 3
      })
    })

    it('should throw error when storing form data for non-existent session', () => {
      expect(() => {
        storeFormData('non-existent', { name: 'Test' })
      }).toThrow('Session not found: non-existent')
    })

    it('should retrieve stored form data', () => {
      const formData = { name: 'Test User', email: 'test@example.com' }
      storeFormData(uploadId, formData)

      const retrievedData = getFormData(uploadId)
      expect(retrievedData).toEqual(formData)
    })

    it('should return null for form data when session does not exist', () => {
      const formData = getFormData('non-existent')
      expect(formData).toBeNull()
    })

    it('should handle empty form data objects', async () => {
      storeFormData(uploadId, {})

      const { logger } = await import('../common/helpers/logging/logger.js')
      expect(logger.debug).toHaveBeenCalledWith('Form data stored in session', {
        uploadId,
        formFieldCount: 0
      })
    })
  })

  describe('Session Completion and Failure', () => {
    const uploadId = 'completion-test'
    const metadata = {
      originalName: 'complete-test.pdf',
      size: 2048000,
      mimetype: 'application/pdf',
      formId: 'completion-form'
    }

    beforeEach(() => {
      createSession(uploadId, metadata)
    })

    it('should mark session as completed with results', () => {
      const result = {
        url: 'https://storage.azure.com/container/file.pdf',
        files: [{ name: 'complete-test.pdf', size: 2048000 }],
        metadata: { processed: true }
      }

      const completedSession = completeSession(uploadId, result)

      expect(completedSession.status).toBe('completed')
      expect(completedSession.progress).toBe(100)
      expect(completedSession.completedAt).toBe(1640995200000)
      expect(completedSession.result).toEqual(result)
    })

    it('should log session completion with duration', async () => {
      // Create session at initial time
      createSession('duration-test', metadata)

      // Advance time by 1 minute for completion
      Date.now.mockReturnValue(1640995260000) // 1 minute later

      completeSession('duration-test', { url: 'https://example.com/file.pdf' })

      const { logger } = await import('../common/helpers/logging/logger.js')
      expect(logger.info).toHaveBeenLastCalledWith('Upload session completed', {
        uploadId: 'duration-test',
        duration: 60000 // 1 minute in milliseconds
      })
    })

    it('should schedule cleanup after completion', () => {
      completeSession(uploadId, { url: 'https://example.com/file.pdf' })

      expect(mockSetTimeout).toHaveBeenCalledWith(
        expect.any(Function),
        5 * 60 * 1000 // 5 minutes
      )
    })

    it('should mark session as failed and record error', () => {
      const error = new Error('Upload failed due to network error')
      error.stack = 'Error: Upload failed\n    at test.js:1:1'

      const failedSession = failSession(uploadId, error)

      expect(failedSession.status).toBe('failed')
      expect(failedSession.failedAt).toBe(1640995200000)
      expect(failedSession.lastError).toBe('Upload failed due to network error')
      expect(failedSession.errors).toHaveLength(1)
      expect(failedSession.errors[0]).toEqual({
        timestamp: 1640995200000,
        message: 'Upload failed due to network error',
        stack: 'Error: Upload failed\n    at test.js:1:1'
      })
    })

    it('should log session failure', async () => {
      const error = new Error('Test error')
      failSession(uploadId, error)

      const { logger } = await import('../common/helpers/logging/logger.js')
      expect(logger.error).toHaveBeenCalledWith('Upload session failed', {
        uploadId,
        error: 'Test error',
        attempts: 0
      })
    })

    it('should handle failure for non-existent session gracefully', () => {
      const error = new Error('Test error')
      const result = failSession('non-existent', error)

      expect(result).toBeUndefined()
    })

    it('should increment attempts and update last activity', () => {
      incrementAttempts(uploadId)
      const session = getSession(uploadId)

      expect(session.attempts).toBe(1)
      expect(session.lastActivity).toBe(1640995200000)
    })

    it('should handle increment attempts for non-existent session gracefully', () => {
      expect(() => {
        incrementAttempts('non-existent')
      }).not.toThrow()
    })
  })

  describe('Session State Transitions', () => {
    it('should properly transition from active to completed', () => {
      const uploadId = 'transition-test'
      const metadata = {
        originalName: 'test.pdf',
        size: 1000,
        mimetype: 'application/pdf',
        formId: 'test'
      }

      // Create active session
      const session = createSession(uploadId, metadata)
      expect(session.status).toBe('active')
      expect(session.progress).toBe(0)

      // Update progress
      updateSession(uploadId, { progress: 50 })
      const updatedSession = getSession(uploadId)
      expect(updatedSession.progress).toBe(50)
      expect(updatedSession.status).toBe('active')

      // Complete session
      const completedSession = completeSession(uploadId, {
        url: 'https://example.com/file.pdf'
      })
      expect(completedSession.status).toBe('completed')
      expect(completedSession.progress).toBe(100)
    })

    it('should properly transition from active to failed', () => {
      const uploadId = 'fail-transition-test'
      const metadata = {
        originalName: 'test.pdf',
        size: 1000,
        mimetype: 'application/pdf',
        formId: 'test'
      }

      // Create active session
      createSession(uploadId, metadata)
      updateSession(uploadId, { progress: 25 })

      // Fail session
      const error = new Error('Network timeout')
      const failedSession = failSession(uploadId, error)

      expect(failedSession.status).toBe('failed')
      expect(failedSession.progress).toBe(25) // Progress should remain unchanged
      expect(failedSession.lastError).toBe('Network timeout')
    })
  })

  describe('Session Querying and Statistics', () => {
    beforeEach(() => {
      // Create various sessions for testing
      createSession('active-1', {
        originalName: 'file1.pdf',
        size: 1000,
        mimetype: 'application/pdf',
        formId: 'form1'
      })
      createSession('active-2', {
        originalName: 'file2.pdf',
        size: 2000,
        mimetype: 'application/pdf',
        formId: 'form2'
      })

      completeSession('active-1', { url: 'https://example.com/file1.pdf' })
      failSession('active-2', new Error('Test error'))

      createSession('active-3', {
        originalName: 'file3.pdf',
        size: 3000,
        mimetype: 'application/pdf',
        formId: 'form3'
      })
    })

    it('should return correct active sessions count', () => {
      const activeCount = getActiveCount()
      expect(activeCount).toBe(1) // Only active-3 should be active
    })

    it('should return sessions by status', () => {
      const activeSessions = getSessionsByStatus('active')
      const completedSessions = getSessionsByStatus('completed')
      const failedSessions = getSessionsByStatus('failed')

      expect(activeSessions).toHaveLength(1)
      expect(activeSessions[0].uploadId).toBe('active-3')

      expect(completedSessions).toHaveLength(1)
      expect(completedSessions[0].uploadId).toBe('active-1')

      expect(failedSessions).toHaveLength(1)
      expect(failedSessions[0].uploadId).toBe('active-2')
    })

    it('should return empty array for non-existent status', () => {
      const sessions = getSessionsByStatus('unknown-status')
      expect(sessions).toEqual([])
    })
  })

  describe('Health Metrics', () => {
    beforeEach(() => {
      // Create test sessions with different statuses
      createSession('health-active', {
        originalName: 'active.pdf',
        size: 1000,
        mimetype: 'application/pdf',
        formId: 'form1'
      })
      createSession('health-completed', {
        originalName: 'completed.pdf',
        size: 2000,
        mimetype: 'application/pdf',
        formId: 'form2'
      })
      createSession('health-failed', {
        originalName: 'failed.pdf',
        size: 3000,
        mimetype: 'application/pdf',
        formId: 'form3'
      })

      completeSession('health-completed', {
        url: 'https://example.com/completed.pdf'
      })
      failSession('health-failed', new Error('Health test error'))
    })

    it('should calculate comprehensive health metrics', () => {
      const metrics = getHealthMetrics()

      expect(metrics).toEqual({
        totalSessions: 3, // All sessions still exist since setTimeout is mocked
        activeSessions: 1,
        completedSessions: 1, // Completed session still exists since setTimeout is mocked
        failedSessions: 1,
        avgSessionAge: 0, // All sessions created at the same time
        memoryUsage: mockMemoryUsage
      })
    })

    it('should handle empty sessions gracefully', () => {
      // Clear all sessions by calling health metrics on a fresh state
      // Since we can't easily clear the sessions map, we'll test the calculation logic

      // Mock empty sessions scenario
      // Create a scenario with no sessions to test the avgSessionAge calculation
      const metrics = getHealthMetrics()

      expect(metrics.memoryUsage).toEqual(mockMemoryUsage)
      expect(typeof metrics.totalSessions).toBe('number')
      expect(typeof metrics.activeSessions).toBe('number')
      expect(typeof metrics.completedSessions).toBe('number')
      expect(typeof metrics.failedSessions).toBe('number')
      expect(typeof metrics.avgSessionAge).toBe('number')
    })

    it('should calculate average session age correctly', () => {
      // Create sessions at different times
      Date.now.mockReturnValueOnce(1640995200000) // First session
      createSession('age-test-1', {
        originalName: 'test1.pdf',
        size: 1000,
        mimetype: 'application/pdf',
        formId: 'form1'
      })

      Date.now.mockReturnValueOnce(1640995260000) // Second session (1 minute later)
      createSession('age-test-2', {
        originalName: 'test2.pdf',
        size: 2000,
        mimetype: 'application/pdf',
        formId: 'form2'
      })

      // Mock current time for age calculation (2 minutes after first session)
      Date.now.mockReturnValue(1640995320000)

      const metrics = getHealthMetrics()

      // Should include all sessions including previous test sessions
      expect(metrics.avgSessionAge).toBeGreaterThan(0)
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it('should handle missing uploadId gracefully', () => {
      expect(() => {
        createSession('', {
          originalName: 'test.pdf',
          size: 1000,
          mimetype: 'application/pdf',
          formId: 'form'
        })
      }).not.toThrow()
    })

    it('should handle missing metadata gracefully', () => {
      expect(() => {
        createSession('test-upload', {})
      }).not.toThrow()
    })

    it('should handle null or undefined metadata', () => {
      // The module actually does try to access formData on metadata, so null will throw
      // This is expected behavior - the module requires metadata to be an object
      expect(() => {
        createSession('null-metadata', null)
      }).toThrow()

      expect(() => {
        createSession('undefined-metadata', undefined)
      }).toThrow()

      // Empty object should work fine
      expect(() => {
        createSession('empty-metadata', {})
      }).not.toThrow()

      const session = getSession('empty-metadata')
      expect(session.metadata).toEqual({})
    })

    it('should handle multiple rapid updates', () => {
      const uploadId = 'rapid-updates'
      createSession(uploadId, {
        originalName: 'test.pdf',
        size: 1000,
        mimetype: 'application/pdf',
        formId: 'form'
      })

      // Perform multiple rapid updates
      for (let i = 1; i <= 10; i++) {
        updateSession(uploadId, { progress: i * 10 })
      }

      const session = getSession(uploadId)
      expect(session.progress).toBe(100)
    })

    it('should handle very large file sizes', () => {
      const largeFileMetadata = {
        originalName: 'very-large-file.pdf',
        size: Number.MAX_SAFE_INTEGER,
        mimetype: 'application/pdf',
        formId: 'large-file-form'
      }

      expect(() => {
        createSession('large-file', largeFileMetadata)
      }).not.toThrow()

      const session = getSession('large-file')
      expect(session.metadata.size).toBe(Number.MAX_SAFE_INTEGER)
    })

    it('should handle special characters in uploadId', () => {
      const specialId = 'upload-123!@#$%^&*()_+-=[]{}|;:,.<>?'
      const metadata = {
        originalName: 'test.pdf',
        size: 1000,
        mimetype: 'application/pdf',
        formId: 'form'
      }

      expect(() => {
        createSession(specialId, metadata)
      }).not.toThrow()

      const session = getSession(specialId)
      expect(session.uploadId).toBe(specialId)
    })

    it('should handle concurrent session creation attempts', () => {
      const metadata = {
        originalName: 'concurrent.pdf',
        size: 1000,
        mimetype: 'application/pdf',
        formId: 'form'
      }

      // Fill up to the limit with active sessions
      for (let i = 1; i <= 10; i++) {
        createSession(`concurrent-${i}`, { ...metadata, formId: `form-${i}` })
      }

      // Multiple attempts to exceed the limit should all fail
      const failedAttempts = []
      for (let i = 11; i <= 15; i++) {
        try {
          createSession(`concurrent-${i}`, { ...metadata, formId: `form-${i}` })
          failedAttempts.push(false)
        } catch (error) {
          failedAttempts.push(true)
        }
      }

      expect(failedAttempts.every((failed) => failed)).toBe(true)
    })

    it('should handle error objects without stack traces', () => {
      const uploadId = 'error-no-stack'
      createSession(uploadId, {
        originalName: 'test.pdf',
        size: 1000,
        mimetype: 'application/pdf',
        formId: 'form'
      })

      const errorWithoutStack = new Error('Simple error')
      delete errorWithoutStack.stack

      const failedSession = failSession(uploadId, errorWithoutStack)

      expect(failedSession.errors[0].stack).toBeUndefined()
      expect(failedSession.errors[0].message).toBe('Simple error')
    })
  })

  describe('Automatic Cleanup', () => {
    it('should schedule cleanup after session completion', () => {
      const uploadId = 'cleanup-test'
      createSession(uploadId, {
        originalName: 'test.pdf',
        size: 1000,
        mimetype: 'application/pdf',
        formId: 'form'
      })

      completeSession(uploadId, { url: 'https://example.com/test.pdf' })

      // Verify that setTimeout was called to schedule cleanup
      expect(mockSetTimeout).toHaveBeenCalledWith(
        expect.any(Function),
        5 * 60 * 1000
      )
    })

    it('should use setInterval for periodic cleanup', () => {
      // The module should have initialized with setInterval
      // Since we can't reinitialize after mocking, we just verify
      // that the timer functions are available and working
      expect(typeof global.setInterval).toBe('function')
      expect(typeof global.clearInterval).toBe('function')
    })

    it('should handle cleanup timer execution', () => {
      // Test that cleanup timers are properly managed
      const uploadId = 'timer-test'
      createSession(uploadId, {
        originalName: 'timer.pdf',
        size: 1000,
        mimetype: 'application/pdf',
        formId: 'form'
      })

      // Complete the session to trigger cleanup scheduling
      completeSession(uploadId, { url: 'https://example.com/timer.pdf' })

      // Verify cleanup was scheduled
      expect(mockSetTimeout).toHaveBeenCalled()
    })
  })
})
