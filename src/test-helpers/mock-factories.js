/**
 * Mock factories for test files
 *
 * This file contains centralized mock factories that create consistent
 * mocks across different test files.
 */

import { vi } from 'vitest'

/**
 * Create upload security mocks that work with both named and default exports
 */
export function createUploadSecurityMock() {
  const mockValidateFileUpload = vi.fn()
  const mockCheckRateLimit = vi.fn()
  const mockValidateFileContent = vi.fn()
  const mockGetSecurityMetrics = vi.fn()
  const mockClearIpData = vi.fn()
  const mockResetSecurityMetrics = vi.fn()
  const mockResetSecurityState = vi.fn()

  // Set up default successful responses
  mockValidateFileUpload.mockReturnValue({ valid: true, errors: [] })
  mockCheckRateLimit.mockReturnValue({
    allowed: true,
    remaining: 50,
    resetTime: Date.now() + 3600000
  })
  mockGetSecurityMetrics.mockReturnValue({
    totalUploads: 0,
    rejectedUploads: 0,
    activeIps: 0
  })

  return {
    validateFileUpload: mockValidateFileUpload,
    checkRateLimit: mockCheckRateLimit,
    validateFileContent: mockValidateFileContent,
    getSecurityMetrics: mockGetSecurityMetrics,
    clearIpData: mockClearIpData,
    resetSecurityMetrics: mockResetSecurityMetrics,
    resetSecurityState: mockResetSecurityState,
    default: {
      validateFileUpload: mockValidateFileUpload,
      checkRateLimit: mockCheckRateLimit,
      validateFileContent: mockValidateFileContent,
      getSecurityMetrics: mockGetSecurityMetrics,
      clearIpData: mockClearIpData,
      resetSecurityMetrics: mockResetSecurityMetrics,
      resetSecurityState: mockResetSecurityState
    }
  }
}

/**
 * Create CDP uploader client mock
 */
export function createCdpUploaderClientMock() {
  const mockValidateFile = vi.fn()
  const mockInitiateUpload = vi.fn()
  const mockDeleteUpload = vi.fn()
  const mockGetUploadStatus = vi.fn()

  // Default successful responses
  mockValidateFile.mockReturnValue({ valid: true, errors: [] })
  mockInitiateUpload.mockResolvedValue({
    uploadId: 'cdp-upload-123',
    uploadUrl: 'https://example.com/upload',
    metadata: { source: 'cdp-uploader' }
  })
  mockDeleteUpload.mockResolvedValue({
    success: true,
    deletedAt: '2024-01-01T12:00:00Z'
  })
  mockGetUploadStatus.mockResolvedValue({
    uploadId: 'upload-123',
    status: 'uploading',
    progress: 80
  })

  return {
    validateFile: mockValidateFile,
    initiateUpload: mockInitiateUpload,
    deleteUpload: mockDeleteUpload,
    getUploadStatus: mockGetUploadStatus
  }
}

/**
 * Create upload session manager mock
 */
export function createUploadSessionManagerMock() {
  const mockCreateSession = vi.fn()
  const mockGetSession = vi.fn()
  const mockUpdateSession = vi.fn()
  const mockCompleteSession = vi.fn()
  const mockFailSession = vi.fn()
  const mockStoreFormData = vi.fn()
  const mockGetFormData = vi.fn()
  const mockGetHealthMetrics = vi.fn()

  // Default successful responses
  mockCreateSession.mockReturnValue({
    id: 'session-123',
    status: 'created'
  })
  mockGetSession.mockReturnValue({
    status: 'active',
    progress: 50,
    createdAt: Date.now() - 60000,
    lastActivity: Date.now(),
    attempts: 1
  })
  mockGetHealthMetrics.mockReturnValue({
    totalSessions: 10,
    activeSessions: 3
  })

  return {
    createSession: mockCreateSession,
    getSession: mockGetSession,
    updateSession: mockUpdateSession,
    completeSession: mockCompleteSession,
    failSession: mockFailSession,
    storeFormData: mockStoreFormData,
    getFormData: mockGetFormData,
    getHealthMetrics: mockGetHealthMetrics
  }
}

/**
 * Create logger mock
 */
export function createLoggerMock() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn()
  }
}

/**
 * Create config mock
 */
export function createConfigMock() {
  const mockGet = vi.fn((key) => {
    switch (key) {
      case 'isProduction':
        return false
      case 'isDevelopment':
        return true
      case 'cdpUploader.callbackAuthToken':
        return 'test-callback-token'
      default:
        return null
    }
  })

  return {
    get: mockGet
  }
}
