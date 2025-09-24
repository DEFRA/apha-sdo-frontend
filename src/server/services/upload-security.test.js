import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import {
  validateFileUpload,
  checkRateLimit,
  validateFileContent,
  getSecurityMetrics,
  clearIpData,
  resetSecurityMetrics,
  resetSecurityState
} from './upload-security.js'
import { logger } from '../common/helpers/logging/logger.js'

vi.mock('../common/helpers/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

describe('Upload Security Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSecurityMetrics()

    clearIpData('192.168.1.1')
    clearIpData('10.0.0.1')
    clearIpData('test-ip')
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  describe('validateFileUpload', () => {
    describe('valid file uploads', () => {
      it('validates a valid PDF file', () => {
        const file = {
          originalname: 'document.pdf',
          size: 1024 * 1024, // 1MB
          mimetype: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4\ntest content')
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(true)
        expect(result.errors).toEqual([])
        expect(result.metadata.securityLevel).toBe('safe')
        expect(result.metadata.riskScore).toBe(0)
        expect(result.metadata.fileHash).toBeDefined()
        expect(typeof result.metadata.fileHash).toBe('string')
      })

      it('validates a valid JPEG image', () => {
        const jpegBuffer = Buffer.from([
          0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46
        ])
        const file = {
          originalname: 'image.jpg',
          size: 512 * 1024, // 512KB
          mimetype: 'image/jpeg',
          buffer: jpegBuffer
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(true)
        expect(result.errors).toEqual([])
        expect(result.metadata.securityLevel).toBe('safe')
      })

      it('validates a valid PNG image', () => {
        const pngBuffer = Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00
        ])
        const file = {
          originalname: 'image.png',
          size: 256 * 1024, // 256KB
          mimetype: 'image/png',
          buffer: pngBuffer
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(true)
        expect(result.errors).toEqual([])
        expect(result.metadata.securityLevel).toBe('safe')
      })

      it('validates with custom options', () => {
        const file = {
          originalname: 'document.txt',
          size: 1024,
          mimetype: 'text/plain',
          buffer: Buffer.from('Hello world')
        }

        const options = {
          allowedMimeTypes: ['text/plain'],
          maxFileSize: 2048,
          clientIp: '192.168.1.1'
        }

        const result = validateFileUpload(file, options)

        expect(result.valid).toBe(true)
        expect(result.metadata.clientIp).toBe('192.168.1.1')
      })
    })

    describe('invalid file uploads', () => {
      it('should reject null or undefined file', () => {
        const result = validateFileUpload(null)

        expect(result.valid).toBe(false)
        expect(result.errors).toContain('File object is required')
      })

      it('should reject file without filename', () => {
        const file = {
          originalname: '',
          size: 1024,
          mimetype: 'text/plain'
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(false)
        expect(result.errors).toContain('File must have a valid filename')
      })

      it('should reject file with invalid size', () => {
        const file = {
          originalname: 'test.txt',
          size: 0,
          mimetype: 'text/plain'
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(false)
        expect(result.errors).toContain('File size must be at least 1 bytes')
      })

      it('should reject file exceeding maximum size', () => {
        const file = {
          originalname: 'large-file.pdf',
          size: 100 * 1024 * 1024, // 100MB (exceeds default 50MB)
          mimetype: 'application/pdf'
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(false)
        expect(result.errors).toContain(
          'File size 104857600 exceeds maximum allowed size of 52428800 bytes'
        )
      })

      it('should reject file without MIME type', () => {
        const file = {
          originalname: 'test.txt',
          size: 1024
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(false)
        expect(result.errors).toContain('File must have a MIME type')
      })

      it('should reject disallowed MIME type', () => {
        const file = {
          originalname: 'script.js',
          size: 1024,
          mimetype: 'application/javascript'
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(false)
        expect(result.errors).toContain(
          "MIME type 'application/javascript' is not allowed"
        )
      })

      it('should reject suspicious file extensions', () => {
        const file = {
          originalname: 'malicious.exe',
          size: 1024,
          mimetype: 'application/pdf'
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(false)
        expect(result.errors).toContain(
          "File extension 'exe' is not allowed for security reasons"
        )
      })

      it('should reject filename with path traversal', () => {
        const file = {
          originalname: '../../../etc/passwd',
          size: 1024,
          mimetype: 'text/plain'
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(false)
        expect(result.errors).toContain(
          'Filename contains invalid path characters'
        )
      })

      it('should reject filename that is too long', () => {
        const file = {
          originalname: 'a'.repeat(256) + '.txt',
          size: 1024,
          mimetype: 'text/plain'
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(false)
        expect(result.errors).toContain(
          'Filename is too long (maximum 255 characters)'
        )
      })

      it('should reject filename with null bytes', () => {
        const file = {
          originalname: 'file\0.txt',
          size: 1024,
          mimetype: 'text/plain'
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(false)
        expect(result.errors).toContain('Filename contains null bytes')
      })
    })

    describe('MIME type validation and spoofing detection', () => {
      it('should detect PDF MIME type spoofing', () => {
        const file = {
          originalname: 'document.pdf',
          size: 1024,
          mimetype: 'application/pdf',
          buffer: Buffer.from('Not a real PDF file')
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(false)
        expect(result.errors).toContain(
          'File claimed to be PDF but does not have PDF magic number'
        )
        expect(result.metadata.riskScore).toBeGreaterThanOrEqual(50)
      })

      it('should detect JPEG MIME type spoofing', () => {
        const file = {
          originalname: 'image.jpg',
          size: 1024,
          mimetype: 'image/jpeg',
          buffer: Buffer.from('Not a real JPEG file')
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(false)
        expect(result.errors).toContain(
          'File claimed to be JPEG but does not have JPEG magic number'
        )
      })

      it('should detect PNG MIME type spoofing', () => {
        const file = {
          originalname: 'image.png',
          size: 1024,
          mimetype: 'image/png',
          buffer: Buffer.from('Not a real PNG file')
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(false)
        expect(result.errors).toContain(
          'File claimed to be PNG but does not have PNG magic number'
        )
      })

      it('should allow files without buffer (no magic number check)', () => {
        const file = {
          originalname: 'document.pdf',
          size: 1024,
          mimetype: 'application/pdf'
          // No buffer property
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(true)
        expect(result.metadata.fileHash).toBeNull()
      })
    })

    describe('malicious content scanning', () => {
      it('should detect PHP tags', () => {
        const file = {
          originalname: 'malicious.txt',
          size: 1024,
          mimetype: 'text/plain',
          buffer: Buffer.from('<?php echo "malicious code"; ?>')
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(false)
        expect(
          result.errors.some((error) => error.includes('malicious content'))
        ).toBe(true)
        expect(result.metadata.riskScore).toBeGreaterThanOrEqual(70)
      })

      it('should detect script tags', () => {
        const file = {
          originalname: 'malicious.html',
          size: 1024,
          mimetype: 'text/plain',
          buffer: Buffer.from('<script>alert("xss")</script>')
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(false)
        expect(
          result.errors.some((error) => error.includes('malicious content'))
        ).toBe(true)
      })

      it('should detect javascript protocols', () => {
        const file = {
          originalname: 'malicious.txt',
          size: 1024,
          mimetype: 'text/plain',
          buffer: Buffer.from('javascript:alert("xss")')
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(false)
        expect(
          result.errors.some((error) => error.includes('malicious content'))
        ).toBe(true)
      })

      it('should detect event handlers', () => {
        const file = {
          originalname: 'malicious.html',
          size: 1024,
          mimetype: 'text/plain',
          buffer: Buffer.from('<img src="x" onclick="alert(1)">')
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(false)
        expect(
          result.errors.some((error) => error.includes('malicious content'))
        ).toBe(true)
      })

      it('should detect system commands', () => {
        const file = {
          originalname: 'malicious.txt',
          size: 1024,
          mimetype: 'text/plain',
          buffer: Buffer.from('cmd.exe /c dir')
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(false)
        expect(
          result.errors.some((error) => error.includes('malicious content'))
        ).toBe(true)
      })

      it('should warn about script content in non-script files', () => {
        const file = {
          originalname: 'document.txt',
          size: 1024,
          mimetype: 'text/plain',
          buffer: Buffer.from(
            'Some text with <script type="text/javascript">alert(1)</script>'
          )
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(true) // Valid but with warnings
        expect(
          result.warnings.some((warning) =>
            warning.includes('script-like content')
          )
        ).toBe(true)
        expect(result.metadata.riskScore).toBeGreaterThan(0)
      })

      it('should warn about high entropy content', () => {
        // Create high-entropy content (random-looking data)
        const highEntropyContent = Array.from({ length: 1000 }, () =>
          String.fromCharCode(Math.floor(Math.random() * 256))
        ).join('')

        const file = {
          originalname: 'suspicious.txt',
          size: highEntropyContent.length,
          mimetype: 'text/plain',
          buffer: Buffer.from(highEntropyContent)
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(true) // Valid but with warnings
        expect(
          result.warnings.some((warning) => warning.includes('high entropy'))
        ).toBe(true)
      })
    })

    describe('security level assessment', () => {
      it('should assign high-risk level for high risk score', () => {
        const file = {
          originalname: 'malicious.exe',
          size: 1024,
          mimetype: 'application/pdf', // Wrong MIME type
          buffer: Buffer.from('<?php echo "evil"; ?>')
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(false)
        expect(result.metadata.securityLevel).toBe('high-risk')
        expect(result.metadata.riskScore).toBeGreaterThanOrEqual(70)
      })

      it('should assign medium-risk level for medium risk score', () => {
        const file = {
          originalname: 'suspicious.txt',
          size: 1024,
          mimetype: 'application/javascript' // Disallowed MIME type
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(false)
        expect(result.metadata.securityLevel).toBe('medium-risk')
        expect(result.metadata.riskScore).toBeGreaterThanOrEqual(30)
        expect(result.metadata.riskScore).toBeLessThan(70)
      })

      it('should assign low-risk level for low risk score', () => {
        const file = {
          originalname: 'file.txt.backup', // Contains suspicious pattern
          size: 1024,
          mimetype: 'text/plain',
          buffer: Buffer.from('Normal content')
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(true)
        expect(result.metadata.securityLevel).toBe('low-risk')
        expect(result.metadata.riskScore).toBeGreaterThan(0)
        expect(result.metadata.riskScore).toBeLessThan(30)
      })
    })

    describe('error handling', () => {
      it('should handle internal errors gracefully', () => {
        // Mock the path module to throw an error
        const originalExtname = require('path').extname
        require('path').extname = vi.fn().mockImplementation(() => {
          throw new Error('Path error')
        })

        const file = {
          originalname: 'test.txt',
          size: 1024,
          mimetype: 'text/plain',
          buffer: Buffer.from('test content')
        }

        const result = validateFileUpload(file)

        expect(result.valid).toBe(false)
        expect(result.errors).toContain('Internal security validation error')
        expect(logger.error).toHaveBeenCalledWith(
          'Security validation error',
          expect.objectContaining({
            error: 'Path error',
            filename: 'test.txt'
          })
        )

        // Restore original function
        require('path').extname = originalExtname
      })
    })

    describe('logging', () => {
      it('should log security validation failures', () => {
        const file = {
          originalname: 'malicious.exe',
          size: 1024,
          mimetype: 'application/pdf'
        }

        const result = validateFileUpload(file, { clientIp: '192.168.1.1' })

        expect(result.valid).toBe(false)
        expect(logger.warn).toHaveBeenCalledWith(
          'File upload security validation failed',
          expect.objectContaining({
            filename: 'malicious.exe',
            clientIp: '192.168.1.1',
            errors: expect.any(Array),
            warnings: expect.any(Array)
          })
        )
      })

      it('should log suspicious files with warnings', () => {
        const file = {
          originalname: 'document.txt',
          size: 1024,
          mimetype: 'text/plain',
          buffer: Buffer.from('Content with <script>alert(1)</script>')
        }

        const result = validateFileUpload(file, { clientIp: '10.0.0.1' })

        expect(result.valid).toBe(true)
        expect(result.warnings.length).toBeGreaterThan(0)
        expect(logger.info).toHaveBeenCalledWith(
          'File upload passed with security warnings',
          expect.objectContaining({
            filename: 'document.txt',
            clientIp: '10.0.0.1'
          })
        )
      })
    })
  })

  describe('checkRateLimit', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2023-01-01T12:00:00Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should allow requests within rate limits', () => {
      const result = checkRateLimit('192.168.1.1')

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(49) // 50 - 1
      expect(result.resetTime).toBeDefined()
      expect(result.retryAfter).toBeUndefined()
    })

    it('should track multiple requests from same IP', () => {
      // Make several requests
      checkRateLimit('192.168.1.1')
      checkRateLimit('192.168.1.1')
      const result = checkRateLimit('192.168.1.1')

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(47) // 50 - 3
    })

    it('should enforce hourly rate limits', () => {
      const clientIp = '192.168.1.1'

      // Make 50 requests (the limit)
      for (let i = 0; i < 50; i++) {
        const result = checkRateLimit(clientIp)
        if (i < 49) {
          expect(result.allowed).toBe(true)
        }
      }

      // 51st request should be blocked
      const blockedResult = checkRateLimit(clientIp)
      expect(blockedResult.allowed).toBe(false)
      expect(blockedResult.remaining).toBe(0)
      expect(blockedResult.retryAfter).toBeGreaterThan(0)
    })

    it('should enforce daily rate limits', () => {
      const clientIp = '192.168.1.1'
      const options = {
        maxPerHour: 300, // Set high hourly limit
        maxPerDay: 5 // Low daily limit
      }

      // Make 5 requests (the daily limit)
      for (let i = 0; i < 5; i++) {
        const result = checkRateLimit(clientIp, options)
        expect(result.allowed).toBe(true)
      }

      // 6th request should be blocked
      const blockedResult = checkRateLimit(clientIp, options)
      expect(blockedResult.allowed).toBe(false)
      expect(blockedResult.remaining).toBe(0)
    })

    it('should handle custom rate limit options', () => {
      const options = {
        maxPerHour: 10,
        maxPerDay: 20
      }

      const result = checkRateLimit('192.168.1.1', options)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(9) // 10 - 1
    })

    it('should clean old requests automatically', () => {
      const clientIp = '192.168.1.1'

      // Make a request
      checkRateLimit(clientIp)

      // Advance time by 25 hours (beyond daily window)
      vi.advanceTimersByTime(25 * 60 * 60 * 1000)

      // Should start fresh
      const result = checkRateLimit(clientIp)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(49) // Fresh count
    })

    it('should handle different IPs independently', () => {
      checkRateLimit('192.168.1.1')
      checkRateLimit('192.168.1.1')

      const ip1Result = checkRateLimit('192.168.1.1')
      const ip2Result = checkRateLimit('10.0.0.1')

      expect(ip1Result.remaining).toBe(47) // Third request from IP1
      expect(ip2Result.remaining).toBe(49) // First request from IP2
    })

    it('should log rate limit violations', () => {
      const clientIp = '192.168.1.1'

      // Exceed the limit
      for (let i = 0; i < 51; i++) {
        checkRateLimit(clientIp)
      }

      expect(logger.warn).toHaveBeenCalledWith(
        'Rate limit exceeded',
        expect.objectContaining({
          clientIp,
          requestsInHour: expect.any(Number),
          requestsInDay: expect.any(Number)
        })
      )
    })

    it('should calculate retry after time correctly', () => {
      const clientIp = '192.168.1.1'

      // Exceed hourly limit
      for (let i = 0; i < 51; i++) {
        checkRateLimit(clientIp)
      }

      const blockedResult = checkRateLimit(clientIp)
      expect(blockedResult.retryAfter).toBeGreaterThan(0)
      expect(blockedResult.retryAfter).toBeLessThanOrEqual(60 * 60 * 1000) // Max 1 hour
    })
  })

  describe('validateFileContent', () => {
    it('validates file content with buffer', () => {
      const file = {
        originalname: 'test.txt',
        buffer: Buffer.from('Safe content')
      }

      const result = validateFileContent(file)

      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
      expect(result.warnings).toEqual([])
    })

    it('should handle file without buffer', () => {
      const file = {
        originalname: 'test.txt'
      }

      const result = validateFileContent(file)

      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
      expect(result.warnings).toEqual([])
    })

    it('should detect malicious content patterns', () => {
      const file = {
        originalname: 'malicious.txt',
        buffer: Buffer.from('<?php system($_GET["cmd"]); ?>')
      }

      const result = validateFileContent(file)

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })
  })

  describe('getSecurityMetrics', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2023-01-01T12:00:00Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should return initial metrics', () => {
      const metrics = getSecurityMetrics()

      expect(metrics).toEqual(
        expect.objectContaining({
          totalUploads: 0,
          rejectedUploads: 0,
          suspiciousFiles: 0,
          rateLimitViolations: 0,
          mimeTypeSpoofing: 0,
          maliciousContentDetected: 0,
          lastIncident: null,
          activeIps: 0,
          recentUploads: 0,
          rejectionRate: 0,
          timestamp: expect.any(String)
        })
      )
    })

    it('should track upload metrics', () => {
      // Create some upload activity
      const validFile = {
        originalname: 'test.pdf',
        size: 1024,
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-test')
      }

      const invalidFile = {
        originalname: 'malicious.exe',
        size: 1024,
        mimetype: 'application/pdf'
      }

      validateFileUpload(validFile)
      validateFileUpload(invalidFile)

      const metrics = getSecurityMetrics()

      expect(metrics.totalUploads).toBe(2)
      expect(metrics.rejectedUploads).toBe(1)
      expect(metrics.rejectionRate).toBe('50.00')
    })

    it('should track rate limit violations', () => {
      const clientIp = '192.168.1.1'

      // Exceed rate limit
      for (let i = 0; i < 51; i++) {
        checkRateLimit(clientIp)
      }

      const metrics = getSecurityMetrics()

      expect(metrics.rateLimitViolations).toBe(1)
      expect(metrics.activeIps).toBe(1)
    })

    it('should calculate recent uploads correctly', () => {
      const clientIp = '192.168.1.1'

      // Make some recent requests
      checkRateLimit(clientIp)
      checkRateLimit(clientIp)

      const metrics = getSecurityMetrics()

      expect(metrics.recentUploads).toBe(2)
    })
  })

  describe('clearIpData', () => {
    it('should clear data for specific IP', () => {
      const clientIp = '192.168.1.1'

      // Create some data
      checkRateLimit(clientIp)
      let metrics = getSecurityMetrics()
      expect(metrics.activeIps).toBe(1)

      // Clear the data
      clearIpData(clientIp)
      metrics = getSecurityMetrics()
      expect(metrics.activeIps).toBe(0)
    })

    it('should not affect other IPs', () => {
      checkRateLimit('192.168.1.1')
      checkRateLimit('10.0.0.1')

      let metrics = getSecurityMetrics()
      expect(metrics.activeIps).toBe(2)

      clearIpData('192.168.1.1')

      metrics = getSecurityMetrics()
      expect(metrics.activeIps).toBe(1)
    })
  })

  describe('resetSecurityMetrics', () => {
    it('should reset all security metrics', () => {
      // Generate some metrics
      const file = {
        originalname: 'test.pdf',
        size: 1024,
        mimetype: 'application/pdf'
      }

      validateFileUpload(file)

      let metrics = getSecurityMetrics()
      expect(metrics.totalUploads).toBe(1)

      // Reset metrics
      resetSecurityMetrics()

      metrics = getSecurityMetrics()
      expect(metrics.totalUploads).toBe(0)
      expect(metrics.rejectedUploads).toBe(0)
      expect(metrics.suspiciousFiles).toBe(0)
      expect(metrics.rateLimitViolations).toBe(0)
      expect(metrics.mimeTypeSpoofing).toBe(0)
      expect(metrics.maliciousContentDetected).toBe(0)
      expect(metrics.lastIncident).toBe(null)
    })
  })

  describe('suspicious file detection', () => {
    it('should detect double extensions', () => {
      const file = {
        originalname: 'document.pdf.exe',
        size: 1024,
        mimetype: 'application/pdf'
      }

      const result = validateFileUpload(file)

      expect(result.valid).toBe(false)
      expect(result.errors.some((error) => error.includes('exe'))).toBe(true)
    })

    it('should warn about suspicious extension patterns', () => {
      const file = {
        originalname: 'document.txt.bat.backup',
        size: 1024,
        mimetype: 'text/plain',
        buffer: Buffer.from('Normal content')
      }

      const result = validateFileUpload(file)

      expect(result.valid).toBe(true)
      expect(
        result.warnings.some((warning) =>
          warning.includes('suspicious extension pattern')
        )
      ).toBe(true)
    })

    it('should handle files with spaces in suspicious extensions', () => {
      const file = {
        originalname: 'document.exe backup.txt',
        size: 1024,
        mimetype: 'text/plain',
        buffer: Buffer.from('Normal content')
      }

      const result = validateFileUpload(file)

      expect(result.valid).toBe(true)
      expect(
        result.warnings.some((warning) =>
          warning.includes('suspicious extension pattern')
        )
      ).toBe(true)
    })
  })

  describe('cleanup functionality', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      resetSecurityState() // Reset initialization state for testing
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should initialize cleanup interval', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval')

      // Trigger initialization
      validateFileUpload({
        originalname: 'test.txt',
        size: 1024,
        mimetype: 'text/plain'
      })

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        15 * 60 * 1000 // 15 minutes
      )
    })

    it('should cleanup old rate limit data', () => {
      const clientIp = '192.168.1.1'

      // Create some rate limit data and initialize the service
      checkRateLimit(clientIp)

      // Verify data exists
      let metrics = getSecurityMetrics()
      expect(metrics.activeIps).toBe(1)

      // Advance time beyond cleanup threshold (25 hours)
      vi.advanceTimersByTime(25 * 60 * 60 * 1000)

      // Trigger cleanup by advancing cleanup interval
      vi.advanceTimersByTime(15 * 60 * 1000)

      // Check if data was cleaned up
      metrics = getSecurityMetrics()
      expect(metrics.activeIps).toBe(0)
    })
  })

  describe('crypto functions', () => {
    it('should generate file hash correctly', () => {
      const file = {
        originalname: 'test.txt',
        size: 1024,
        mimetype: 'text/plain',
        buffer: Buffer.from('test content')
      }

      const result = validateFileUpload(file)

      expect(result.metadata.fileHash).toBeDefined()
      expect(typeof result.metadata.fileHash).toBe('string')
      expect(result.metadata.fileHash).toMatch(/^[a-f0-9]{64}$/) // SHA256 hash format
    })

    it('should handle crypto errors gracefully', () => {
      // Mock crypto.createHash to throw an error
      const originalCreateHash = crypto.createHash
      crypto.createHash = vi.fn().mockImplementation(() => {
        throw new Error('Hash generation failed')
      })

      const file = {
        originalname: 'test.txt',
        size: 1024,
        mimetype: 'text/plain',
        buffer: Buffer.from('test content')
      }

      const result = validateFileUpload(file)

      // In test environment, should fall back to 'mocked-hash-value'
      expect(result.valid).toBe(true)
      expect(result.metadata.fileHash).toBe('mocked-hash-value')

      // Restore original function
      crypto.createHash = originalCreateHash
    })
  })

  describe('edge cases and boundary conditions', () => {
    it('should handle empty file buffer', () => {
      const file = {
        originalname: 'empty.txt',
        size: 1,
        mimetype: 'text/plain',
        buffer: Buffer.alloc(0)
      }

      const result = validateFileUpload(file)

      expect(result.valid).toBe(true)
      expect(result.metadata.fileHash).toBeDefined()
      expect(typeof result.metadata.fileHash).toBe('string')
    })

    it('should handle very large file names at boundary', () => {
      const file = {
        originalname: 'a'.repeat(255) + '.txt', // Exactly 259 characters
        size: 1024,
        mimetype: 'text/plain'
      }

      const result = validateFileUpload(file)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
        'Filename is too long (maximum 255 characters)'
      )
    })

    it('should handle minimum file size boundary', () => {
      const file = {
        originalname: 'minimal.txt',
        size: 1, // Exactly minimum size
        mimetype: 'text/plain'
      }

      const result = validateFileUpload(file)

      expect(result.valid).toBe(true)
    })

    it('should handle maximum file size boundary', () => {
      const file = {
        originalname: 'maximal.txt',
        size: 50 * 1024 * 1024, // Exactly maximum size
        mimetype: 'text/plain'
      }

      const result = validateFileUpload(file)

      expect(result.valid).toBe(true)
    })

    it('should handle case-insensitive MIME types', () => {
      const file = {
        originalname: 'test.pdf',
        size: 1024,
        mimetype: 'APPLICATION/PDF', // Uppercase
        buffer: Buffer.from('%PDF-test')
      }

      const result = validateFileUpload(file)

      expect(result.valid).toBe(true)
    })

    it('should handle case-insensitive extensions', () => {
      const file = {
        originalname: 'MALICIOUS.EXE', // Uppercase extension
        size: 1024,
        mimetype: 'text/plain'
      }

      const result = validateFileUpload(file)

      expect(result.valid).toBe(false)
      expect(result.errors.some((error) => error.includes('exe'))).toBe(true)
    })
  })
})
