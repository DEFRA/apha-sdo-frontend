/**
 * Test setup for Vitest
 *
 * This file contains global test configuration and utilities
 * that are automatically loaded before running tests.
 */

import { vi } from 'vitest'

// Global test utilities
global.testUtils = {
  createMockFile: (overrides = {}) => ({
    originalname: 'test-file.pdf',
    size: 1024000,
    mimetype: 'application/pdf',
    buffer: Buffer.from('mock-file-content'),
    ...overrides
  }),

  createMockUploadOptions: (overrides = {}) => ({
    allowedMimeTypes: ['application/pdf'],
    metadata: { userId: 'user-123' },
    formData: { field1: 'value1' },
    clientIp: '192.168.1.1',
    ...overrides
  }),

  createMockCallbackData: (overrides = {}) => ({
    uploadId: 'upload-123',
    status: 'completed',
    retrievalKey: 'key-123',
    metadata: { formId: 'test-form' },
    files: [{ filename: 'test.pdf', size: 1024, mimetype: 'application/pdf' }],
    ...overrides
  }),

  createMockRequest: (overrides = {}) => ({
    headers: {
      authorization: 'Bearer test-token',
      ...overrides.headers
    },
    ...overrides
  }),

  // Helper to wait for async operations
  waitFor: (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms)),

  // Helper to create deterministic mock timestamps
  mockTimestamp: 1640995200000 // 2022-01-01T00:00:00.000Z
}

// Mock global Date for consistent timestamps in tests
vi.spyOn(Date, 'now').mockReturnValue(global.testUtils.mockTimestamp)

// Ensure console methods are available for testing
if (!globalThis.console) {
  globalThis.console = {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}

// Set default timezone for consistent date handling
process.env.TZ = 'UTC'

// Cleanup after each test
afterEach(() => {
  vi.clearAllTimers()
})
