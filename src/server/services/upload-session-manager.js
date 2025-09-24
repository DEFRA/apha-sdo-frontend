import { logger } from '../common/helpers/logging/logger.js'

/**
 * Upload Session Manager
 * Manages upload session lifecycle with automatic cleanup and concurrent limits.
 */

// Private state
const state = {
  sessions: new Map(),
  cleanupInterval: 5 * 60 * 1000, // 5 minutes
  sessionTTL: 60 * 60 * 1000, // 1 hour
  maxConcurrentUploads: 10,
  cleanupTimer: null
}

/**
 * Create new upload session with concurrent limit enforcement
 */
export function createSession(uploadId, metadata) {
  const activeUploads = Array.from(state.sessions.values()).filter(
    (session) => session.status === 'active'
  ).length

  if (activeUploads >= state.maxConcurrentUploads) {
    throw new Error('Maximum concurrent uploads exceeded')
  }

  const session = {
    uploadId,
    status: 'active',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    progress: 0,
    metadata,
    formData: metadata.formData || null,
    attempts: 0,
    errors: []
  }

  state.sessions.set(uploadId, session)

  logger.info('Upload session created', {
    uploadId,
    formId: metadata.formId,
    filename: metadata.originalName
  })

  return session
}

/**
 * Update session with new status, progress or metadata
 */
export function updateSession(uploadId, updates) {
  const session = state.sessions.get(uploadId)
  if (!session) {
    throw new Error(`Session not found: ${uploadId}`)
  }

  Object.assign(session, {
    ...updates,
    lastActivity: Date.now()
  })

  logger.debug('Upload session updated', {
    uploadId,
    status: session.status,
    progress: session.progress
  })

  return session
}

/**
 * Get session data by upload ID
 */
export function getSession(uploadId) {
  return state.sessions.get(uploadId) || null
}

/**
 * Store form data for Azure JSON upload
 */
export function storeFormData(uploadId, formData) {
  const session = state.sessions.get(uploadId)
  if (!session) {
    throw new Error(`Session not found: ${uploadId}`)
  }

  session.formData = formData
  session.lastActivity = Date.now()

  logger.debug('Form data stored in session', {
    uploadId,
    formFieldCount: Object.keys(formData || {}).length
  })

  return session
}

/**
 * Get stored form data for session
 */
export function getFormData(uploadId) {
  const session = state.sessions.get(uploadId)
  return session ? session.formData : null
}

/**
 * Mark session completed and schedule cleanup
 */
export function completeSession(uploadId, result) {
  const session = updateSession(uploadId, {
    status: 'completed',
    progress: 100,
    completedAt: Date.now(),
    result
  })

  logger.info('Upload session completed', {
    uploadId,
    duration: session.completedAt - session.createdAt
  })

  setTimeout(
    () => {
      state.sessions.delete(uploadId)
    },
    5 * 60 * 1000
  )

  return session
}

/**
 * Mark session failed with error details
 */
export function failSession(uploadId, error) {
  const session = state.sessions.get(uploadId)
  if (!session) return

  session.errors.push({
    timestamp: Date.now(),
    message: error.message,
    stack: error.stack
  })

  updateSession(uploadId, {
    status: 'failed',
    failedAt: Date.now(),
    lastError: error.message
  })

  logger.error('Upload session failed', {
    uploadId,
    error: error.message,
    attempts: session.attempts
  })

  return session
}

export function incrementAttempts(uploadId) {
  const session = state.sessions.get(uploadId)
  if (session) {
    session.attempts++
    session.lastActivity = Date.now()
  }
}

export function getActiveCount() {
  return Array.from(state.sessions.values()).filter(
    (session) => session.status === 'active'
  ).length
}

export function getSessionsByStatus(status) {
  return Array.from(state.sessions.values()).filter(
    (session) => session.status === status
  )
}

function startCleanup() {
  if (state.cleanupTimer) {
    clearInterval(state.cleanupTimer)
  }

  state.cleanupTimer = setInterval(() => {
    cleanupExpiredSessions()
  }, state.cleanupInterval)

  logger.info('Upload session cleanup started', {
    interval: state.cleanupInterval,
    ttl: state.sessionTTL
  })
}

function cleanupExpiredSessions() {
  const now = Date.now()
  let cleanedCount = 0

  for (const [uploadId, session] of state.sessions) {
    const age = now - session.createdAt
    const inactive = now - session.lastActivity

    if (age > state.sessionTTL || inactive > state.sessionTTL) {
      state.sessions.delete(uploadId)
      cleanedCount++

      logger.debug('Upload session cleaned up', {
        uploadId,
        age,
        inactive,
        status: session.status
      })
    }
  }

  if (cleanedCount > 0) {
    logger.info('Upload session cleanup completed', {
      cleanedCount,
      remainingCount: state.sessions.size
    })
  }
}

/**
 * Get health metrics for monitoring
 */
export function getHealthMetrics() {
  const sessions = Array.from(state.sessions.values())

  return {
    totalSessions: sessions.length,
    activeSessions: sessions.filter((s) => s.status === 'active').length,
    completedSessions: sessions.filter((s) => s.status === 'completed').length,
    failedSessions: sessions.filter((s) => s.status === 'failed').length,
    avgSessionAge:
      sessions.length > 0
        ? sessions.reduce((sum, s) => sum + (Date.now() - s.createdAt), 0) /
          sessions.length
        : 0,
    memoryUsage: process.memoryUsage()
  }
}

export function __clearAllSessions() {
  state.sessions.clear()
}

startCleanup()

const uploadSessionManager = {
  createSession,
  updateSession,
  getSession,
  completeSession,
  failSession,
  incrementAttempts,
  getActiveCount,
  getSessionsByStatus,
  getHealthMetrics
}

export default uploadSessionManager
