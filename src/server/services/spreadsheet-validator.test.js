import { describe, it, expect, beforeEach } from 'vitest'
import { SpreadsheetValidator } from './spreadsheet-validator.js'

describe('SpreadsheetValidator', () => {
  let validator

  beforeEach(() => {
    validator = new SpreadsheetValidator()
  })

  describe('validateFile', () => {
    it('should validate acceptable file types', () => {
      const file = {
        originalname: 'test.xlsx',
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 1024 * 1024 // 1MB
      }

      const result = validator.validateFile(file)

      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.fileInfo.extension).toBe('xlsx')
    })

    it('should reject oversized files', () => {
      const file = {
        originalname: 'huge.xlsx',
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 100 * 1024 * 1024 // 100MB
      }

      const result = validator.validateFile(file)

      expect(result.isValid).toBe(false)
      expect(result.errors[0]).toContain('exceeds limit')
    })

    it('should reject unsupported file types', () => {
      const file = {
        originalname: 'document.pdf',
        mimetype: 'application/pdf',
        size: 1024
      }

      const result = validator.validateFile(file)

      expect(result.isValid).toBe(false)
      expect(result.errors.some((err) => err.includes('is not allowed'))).toBe(
        true
      )
    })

    it('should reject files with bad extensions', () => {
      const file = {
        originalname: 'script.exe',
        mimetype: 'text/csv',
        size: 1024
      }

      const result = validator.validateFile(file)

      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('File extension .exe is not supported')
    })
  })

  describe('validateCsvContent', () => {
    it('should validate valid CSV content', async () => {
      const csvBuffer = Buffer.from(
        'name,age,city\nJohn,25,London\nJane,30,Paris'
      )

      const result = await validator.validateCsvContent(csvBuffer)

      expect(result.isValid).toBe(true)
      expect(result.sheets).toHaveLength(1)
      expect(result.sheets[0].rowCount).toBe(2) // excluding header
      expect(result.sheets[0].hasHeaders).toBe(true)
    })

    it('should handle empty CSV files', async () => {
      const csvBuffer = Buffer.from('')

      const result = await validator.validateCsvContent(csvBuffer)

      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('CSV file is empty')
    })
  })

  describe('generateValidationReport', () => {
    it('should generate a comprehensive validation report', () => {
      const validation = {
        isValid: true,
        errors: [],
        fileInfo: {
          originalName: 'test.xlsx',
          size: 1024,
          mimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          extension: 'xlsx'
        },
        sheets: [
          {
            name: 'Sheet1',
            rowCount: 10,
            columnCount: 5,
            hasHeaders: true
          }
        ]
      }

      const report = validator.generateValidationReport(validation)

      expect(report.timestamp).toBeDefined()
      expect(report.isValid).toBe(true)
      expect(report.sheets).toHaveLength(1)
      expect(report.sheets[0].name).toBe('Sheet1')
    })
  })
})
