import { describe, it, expect } from 'vitest'
import { uploadConfig } from '../../src/config/upload-config.js'

describe('Upload Configuration', () => {
  describe('File Type Support', () => {
    it('should include XLSM in allowed file types', () => {
      const config = uploadConfig.getFormsEngineConfig()

      expect(config.allowedFileTypes).toBeDefined()
      expect(config.allowedFileTypes).toContain('.xlsm')
    })

    it('should include all supported spreadsheet formats', () => {
      const config = uploadConfig.getFormsEngineConfig()
      const expectedFormats = [
        '.csv',
        '.xls',
        '.xlsx',
        '.ods',
        '.xlsm',
        '.xlsb'
      ]

      expectedFormats.forEach((format) => {
        expect(config.allowedFileTypes).toContain(format)
      })
    })

    it('should include XLSM MIME type in allowed MIME types', () => {
      const config = uploadConfig.getFormsEngineConfig()

      expect(config.allowedMimeTypes).toBeDefined()
      expect(config.allowedMimeTypes).toContain(
        'application/vnd.ms-excel.sheet.macroEnabled.12'
      )
    })

    it('should include all supported MIME types', () => {
      const config = uploadConfig.getFormsEngineConfig()
      const expectedMimeTypes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
        'application/vnd.ms-excel', // .xls
        'text/csv', // .csv
        'application/vnd.oasis.opendocument.spreadsheet', // .ods
        'application/vnd.ms-excel.sheet.macroEnabled.12', // .xlsm
        'application/vnd.ms-excel.sheet.macroenabled.12', // .xlsm (lowercase variant)
        'application/vnd.ms-excel.sheet.binary.macroEnabled.12', // .xlsb
        'application/octet-stream' // Generic binary
      ]

      expectedMimeTypes.forEach((mimeType) => {
        expect(config.allowedMimeTypes).toContain(mimeType)
      })
    })
  })

  describe('Forms Engine Configuration', () => {
    it('should return complete forms engine config', () => {
      const config = uploadConfig.getFormsEngineConfig()

      expect(config.uploadPath).toBeDefined()
      expect(config.maxFileSize).toBeDefined()
      expect(config.allowedFileTypes).toBeDefined()
      expect(config.allowedMimeTypes).toBeDefined()
      expect(config.uploadDirectory).toBeDefined()
    })

    it('should have consistent file size limits', () => {
      const config = uploadConfig.getFormsEngineConfig()

      expect(config.maxFileSize).toBe(52428800) // 50MB
    })
  })
})
