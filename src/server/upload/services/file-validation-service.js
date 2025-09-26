import { uploadConfig } from '../../../config/upload-config.js'
import mimeTypes from 'mime-types'
import path from 'node:path'

export const fileValidationService = {
  async validateFile(payload) {
    const errors = []
    const config = uploadConfig.getFormsEngineConfig()

    if (!payload.file) {
      errors.push('No file provided')
      return { isValid: false, errors }
    }

    const file = payload.file
    const filename = file.hapi?.filename || 'unknown'
    const contentType =
      file.hapi?.headers['content-type'] || 'application/octet-stream'

    // Validate file size
    const size = await this.getFileSize(file)
    if (size > config.maxFileSize) {
      errors.push(
        `File size ${this.formatBytes(size)} exceeds maximum allowed size of ${this.formatBytes(config.maxFileSize)}`
      )
    }

    // Validate file extension
    const extension = path.extname(filename).toLowerCase()
    if (!config.allowedFileTypes.includes(extension)) {
      errors.push(
        `File type '${extension}' is not allowed. Allowed types: ${config.allowedFileTypes.join(', ')}`
      )
    }

    // Validate MIME type
    const expectedMimeType = mimeTypes.lookup(extension)
    if (expectedMimeType && contentType !== expectedMimeType) {
      // Allow some flexibility for common variations
      if (!this.isMimeTypeCompatible(contentType, expectedMimeType)) {
        errors.push(
          `File MIME type '${contentType}' does not match extension '${extension}'`
        )
      }
    }

    // Validate filename
    const filenameValidation = this.validateFilename(filename)
    if (!filenameValidation.isValid) {
      errors.push(...filenameValidation.errors)
    }

    // Check for suspicious file patterns
    const suspiciousCheck = this.checkSuspiciousPatterns(filename, contentType)
    if (!suspiciousCheck.isValid) {
      errors.push(...suspiciousCheck.errors)
    }

    return {
      isValid: errors.length === 0,
      errors,
      metadata: {
        filename,
        extension,
        contentType,
        size,
        sizeFormatted: this.formatBytes(size)
      }
    }
  },

  validateFilename(filename) {
    const errors = []

    // Check length
    if (filename.length > 255) {
      errors.push('Filename is too long (maximum 255 characters)')
    }

    // Check for invalid characters
    // eslint-disable-next-line no-control-regex
    const invalidChars = /[<>:"|?*\x00-\x1f]/g
    if (invalidChars.test(filename)) {
      errors.push('Filename contains invalid characters')
    }

    // Check for reserved names (Windows)
    const reservedNames = [
      'CON',
      'PRN',
      'AUX',
      'NUL',
      'COM1',
      'COM2',
      'COM3',
      'COM4',
      'COM5',
      'COM6',
      'COM7',
      'COM8',
      'COM9',
      'LPT1',
      'LPT2',
      'LPT3',
      'LPT4',
      'LPT5',
      'LPT6',
      'LPT7',
      'LPT8',
      'LPT9'
    ]
    const baseName = path
      .basename(filename, path.extname(filename))
      .toUpperCase()
    if (reservedNames.includes(baseName)) {
      errors.push('Filename uses a reserved system name')
    }

    // Check for hidden files (starting with .)
    if (filename.startsWith('.')) {
      errors.push('Hidden files are not allowed')
    }

    // Check for double extensions (potential security risk)
    const extensions = filename.match(/\.[^.]+/g) || []
    if (extensions.length > 1) {
      errors.push('Files with multiple extensions are not allowed')
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  },

  checkSuspiciousPatterns(filename, contentType) {
    const errors = []

    const executableExtensions = [
      '.exe',
      '.bat',
      '.cmd',
      '.scr',
      '.pif',
      '.vbs',
      '.js',
      '.jar',
      '.com',
      '.psc1'
    ]
    const extension = path.extname(filename).toLowerCase()

    if (executableExtensions.includes(extension)) {
      errors.push('Executable files are not allowed')
    }

    const scriptExtensions = [
      '.php',
      '.asp',
      '.aspx',
      '.jsp',
      '.pl',
      '.py',
      '.rb',
      '.sh'
    ]
    if (scriptExtensions.includes(extension)) {
      errors.push('Script files are not allowed')
    }

    const dangerousMimeTypes = [
      'application/x-executable',
      'application/x-msdownload',
      'application/x-sh',
      'text/x-php',
      'application/x-httpd-php'
    ]

    if (dangerousMimeTypes.includes(contentType)) {
      errors.push('File type is not allowed for security reasons')
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  },

  isMimeTypeCompatible(actual, expected) {
    if (actual === expected) {
      return true
    }

    const compatibleTypes = {
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        ['application/octet-stream'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
        'application/octet-stream'
      ],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation':
        ['application/octet-stream'],
      'image/jpeg': ['image/jpg'],
      'image/jpg': ['image/jpeg']
    }

    const allowedVariations = compatibleTypes[expected] || []
    return allowedVariations.includes(actual)
  },

  async getFileSize(file) {
    if (file._readableState?.buffer?.length) {
      return file._readableState.buffer.length
    }

    const chunks = []

    return new Promise((resolve, reject) => {
      const originalFile = file

      file.on('data', (chunk) => {
        chunks.push(chunk)
      })

      file.on('end', () => {
        const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0)

        const { Readable } = require('stream')
        const newStream = new Readable({
          read() {}
        })

        chunks.forEach((chunk) => newStream.push(chunk))
        newStream.push(null)

        newStream.hapi = originalFile.hapi

        resolve(totalSize)
      })

      file.on('error', reject)
    })
  },

  async performVirusScan(file) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const isClean = Math.random() > 0.01 // 99% of files are clean in simulation

        resolve({
          isClean,
          scanResult: isClean ? 'clean' : 'infected',
          threats: isClean ? [] : ['Test.Threat.Simulation']
        })
      }, 500)
    })
  },

  async validateFileContent(file) {
    const errors = []

    try {
      const buffer = await this.readFirstBytes(file, 512)

      const signature = this.getFileSignature(buffer)
      if (signature && signature.suspicious) {
        errors.push(
          `File signature indicates potentially dangerous content: ${signature.type}`
        )
      }

      if (this.hasEmbeddedExecutable(buffer)) {
        errors.push('File appears to contain embedded executable content')
      }
    } catch (error) {
      errors.push(`Content validation failed: ${error.message}`)
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  },

  async readFirstBytes(file, numBytes) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let totalBytes = 0

      file.on('data', (chunk) => {
        chunks.push(chunk)
        totalBytes += chunk.length

        if (totalBytes >= numBytes) {
          file.pause()
          resolve(Buffer.concat(chunks).slice(0, numBytes))
        }
      })

      file.on('end', () => {
        resolve(Buffer.concat(chunks))
      })

      file.on('error', reject)
    })
  },

  getFileSignature(buffer) {
    const signatures = {
      MZ: { type: 'PE executable', suspicious: true },
      '\x7fELF': { type: 'ELF executable', suspicious: true },
      PK: { type: 'ZIP/Office document', suspicious: false },
      '%PDF': { type: 'PDF document', suspicious: false },
      '\xff\xd8\xff': { type: 'JPEG image', suspicious: false },
      '\x89PNG': { type: 'PNG image', suspicious: false }
    }

    for (const [sig, info] of Object.entries(signatures)) {
      if (
        buffer.toString('ascii', 0, sig.length) === sig ||
        buffer.toString('binary', 0, sig.length) === sig
      ) {
        return info
      }
    }

    return null
  },

  hasEmbeddedExecutable(buffer) {
    const content = buffer.toString('binary')

    if (content.includes('MZ') && content.includes('PE\x00\x00')) {
      return true
    }

    if (content.includes('\x7fELF')) {
      return true
    }

    return false
  },

  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes'

    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['Bytes', 'KB', 'MB', 'GB']

    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
  }
}
