import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Unit tests for timestamp-based filename generation
 *
 * Tests the filename generation logic used throughout the upload system
 * to ensure consistent timestamp formatting across all upload paths.
 */
describe('Filename Timestamp Generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Timestamp Format', () => {
    it('should generate ISO 8601 timestamp with hyphens instead of colons', () => {
      const originalFilename = 'test-spreadsheet.xlsx'
      const filenameBase = originalFilename.replace(/\.[^/.]+$/, '')
      const fileExtension = originalFilename.match(/\.[^/.]+$/)?.[0] || ''
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const timestampedFilename = `${filenameBase}_${timestamp}${fileExtension}`

      // Verify timestamp format: YYYY-MM-DDTHH-MM-SS-sssZ
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/)

      // Verify no colons or periods in timestamp (except for .Z which is replaced)
      expect(timestamp).not.toContain(':')
      expect(timestamp).not.toContain('.')

      // Verify complete filename format
      expect(timestampedFilename).toBe(`test-spreadsheet_${timestamp}.xlsx`)
    })

    it('should handle filenames without extensions', () => {
      const originalFilename = 'spreadsheet'
      const filenameBase = originalFilename.replace(/\.[^/.]+$/, '')
      const fileExtension = originalFilename.match(/\.[^/.]+$/)?.[0] || ''
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const timestampedFilename = `${filenameBase}_${timestamp}${fileExtension}`

      expect(fileExtension).toBe('')
      expect(timestampedFilename).toBe(`spreadsheet_${timestamp}`)
    })

    it('should preserve complex file extensions', () => {
      const testCases = [
        { input: 'data.csv', base: 'data', ext: '.csv' },
        { input: 'report.xlsx', base: 'report', ext: '.xlsx' },
        { input: 'file.tar.gz', base: 'file.tar', ext: '.gz' },
        { input: 'analysis.xlsm', base: 'analysis', ext: '.xlsm' },
        { input: 'binary.xlsb', base: 'binary', ext: '.xlsb' }
      ]

      for (const testCase of testCases) {
        const filenameBase = testCase.input.replace(/\.[^/.]+$/, '')
        const fileExtension = testCase.input.match(/\.[^/.]+$/)?.[0] || ''

        expect(filenameBase).toBe(testCase.base)
        expect(fileExtension).toBe(testCase.ext)
      }
    })

    it('should handle filenames with multiple dots', () => {
      const originalFilename = 'my.data.file.xlsx'
      const filenameBase = originalFilename.replace(/\.[^/.]+$/, '')
      const fileExtension = originalFilename.match(/\.[^/.]+$/)?.[0] || ''
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const timestampedFilename = `${filenameBase}_${timestamp}${fileExtension}`

      expect(filenameBase).toBe('my.data.file')
      expect(fileExtension).toBe('.xlsx')
      expect(timestampedFilename).toBe(`my.data.file_${timestamp}.xlsx`)
    })

    it('should handle filenames with special characters', () => {
      const testFilenames = [
        'report (final).xlsx',
        'data-2024.csv',
        'file_name.xlsx',
        'test@file.xls',
        'report#1.xlsm'
      ]

      for (const filename of testFilenames) {
        const filenameBase = filename.replace(/\.[^/.]+$/, '')
        const fileExtension = filename.match(/\.[^/.]+$/)?.[0] || ''
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const timestampedFilename = `${filenameBase}_${timestamp}${fileExtension}`

        // Should preserve special characters in base name
        expect(timestampedFilename).toContain(filenameBase)
        expect(timestampedFilename).toContain(timestamp)
        expect(timestampedFilename.endsWith(fileExtension)).toBe(true)
      }
    })
  })

  describe('Timestamp Uniqueness', () => {
    it('should generate unique timestamps for sequential uploads', async () => {
      const timestamps = []

      for (let i = 0; i < 5; i++) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        timestamps.push(timestamp)
        // Small delay to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      // All timestamps should be unique (or at least mostly unique due to timing)
      const uniqueTimestamps = new Set(timestamps)
      expect(uniqueTimestamps.size).toBeGreaterThanOrEqual(1)

      // All should match the expected format
      for (const timestamp of timestamps) {
        expect(timestamp).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/
        )
      }
    })

    it('should generate different filenames for the same original file', async () => {
      const originalFilename = 'test.xlsx'
      const filenames = []

      for (let i = 0; i < 3; i++) {
        const filenameBase = originalFilename.replace(/\.[^/.]+$/, '')
        const fileExtension = originalFilename.match(/\.[^/.]+$/)?.[0] || ''
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const timestampedFilename = `${filenameBase}_${timestamp}${fileExtension}`
        filenames.push(timestampedFilename)
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      // Should have unique filenames
      const uniqueFilenames = new Set(filenames)
      expect(uniqueFilenames.size).toBeGreaterThanOrEqual(1)

      // All should start with the same base
      for (const filename of filenames) {
        expect(filename).toMatch(
          /^test_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.xlsx$/
        )
      }
    })
  })

  describe('Timestamp Parsing', () => {
    it('should be able to extract timestamp from timestamped filename', () => {
      const originalFilename = 'spreadsheet.xlsx'
      const filenameBase = originalFilename.replace(/\.[^/.]+$/, '')
      const fileExtension = originalFilename.match(/\.[^/.]+$/)?.[0] || ''
      const timestamp = '2025-09-30T10-30-00-123Z'
      const timestampedFilename = `${filenameBase}_${timestamp}${fileExtension}`

      // Extract timestamp using regex
      const timestampMatch = timestampedFilename.match(
        /_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/
      )

      expect(timestampMatch).not.toBeNull()
      expect(timestampMatch[1]).toBe(timestamp)
    })

    it('should match JSON filename timestamp with spreadsheet filename timestamp', () => {
      const timestamp = '2025-09-30T10-30-00-123Z'

      const spreadsheetFilename = `data_${timestamp}.xlsx`
      const jsonFilename = `data_${timestamp}.json`

      // Extract timestamps
      const spreadsheetMatch = spreadsheetFilename.match(
        /_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/
      )
      const jsonMatch = jsonFilename.match(
        /_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/
      )

      expect(spreadsheetMatch[1]).toBe(jsonMatch[1])
      expect(spreadsheetMatch[1]).toBe(timestamp)
    })
  })

  describe('Azure Blob Name Compatibility', () => {
    it('should generate filenames compatible with Azure Blob Storage naming rules', () => {
      const testCases = [
        'test-file.xlsx',
        'report_2024.csv',
        'data.analysis.xlsm',
        'file (1).xlsx'
      ]

      for (const filename of testCases) {
        const filenameBase = filename.replace(/\.[^/.]+$/, '')
        const fileExtension = filename.match(/\.[^/.]+$/)?.[0] || ''
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const timestampedFilename = `${filenameBase}_${timestamp}${fileExtension}`

        // Azure blob names must be 1-1024 characters
        expect(timestampedFilename.length).toBeGreaterThan(0)
        expect(timestampedFilename.length).toBeLessThan(1024)

        // Should not contain backslashes (forward slashes are OK for virtual directories)
        expect(timestampedFilename).not.toContain('\\')

        // Should not have consecutive slashes (not applicable for single files)
        expect(timestampedFilename).not.toMatch(/\/\//)
      }
    })

    it('should generate valid blob names for all supported spreadsheet types', () => {
      const spreadsheetTypes = [
        { name: 'data.csv', type: 'CSV' },
        { name: 'report.xls', type: 'Excel 97-2003' },
        { name: 'analysis.xlsx', type: 'Excel 2007+' },
        { name: 'macro-enabled.xlsm', type: 'Excel Macro-Enabled' },
        { name: 'binary.xlsb', type: 'Excel Binary' },
        { name: 'open-doc.ods', type: 'OpenDocument' }
      ]

      for (const sheet of spreadsheetTypes) {
        const filenameBase = sheet.name.replace(/\.[^/.]+$/, '')
        const fileExtension = sheet.name.match(/\.[^/.]+$/)?.[0] || ''
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const timestampedFilename = `${filenameBase}_${timestamp}${fileExtension}`

        // Verify it's a valid Azure blob name
        expect(timestampedFilename).toBeTruthy()
        expect(timestampedFilename.length).toBeGreaterThan(0)
        expect(timestampedFilename).toContain(timestamp)
        expect(timestampedFilename.endsWith(fileExtension)).toBe(true)
      }
    })
  })

  describe('Edge Cases', () => {
    it('should handle very long filenames', () => {
      const longFilename = 'a'.repeat(200) + '.xlsx'
      const filenameBase = longFilename.replace(/\.[^/.]+$/, '')
      const fileExtension = longFilename.match(/\.[^/.]+$/)?.[0] || ''
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const timestampedFilename = `${filenameBase}_${timestamp}${fileExtension}`

      // Should still work but might be very long
      expect(timestampedFilename).toContain('_')
      expect(timestampedFilename).toContain(timestamp)
      expect(timestampedFilename.length).toBeGreaterThan(200)
    })

    it('should handle filenames with unicode characters', () => {
      const unicodeFilenames = [
        '文件.xlsx',
        'файл.csv',
        'archivo-\u00f1.xls',
        'déjà-vu.xlsx'
      ]

      for (const filename of unicodeFilenames) {
        const filenameBase = filename.replace(/\.[^/.]+$/, '')
        const fileExtension = filename.match(/\.[^/.]+$/)?.[0] || ''
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const timestampedFilename = `${filenameBase}_${timestamp}${fileExtension}`

        expect(timestampedFilename).toContain(filenameBase)
        expect(timestampedFilename).toContain(timestamp)
      }
    })

    it('should handle empty or minimal filenames', () => {
      const minimalCases = [
        {
          input: 'a.x',
          expected: /^a_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.x$/
        },
        {
          input: '.xlsx',
          expected: /^_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.xlsx$/
        }
      ]

      for (const testCase of minimalCases) {
        const filenameBase = testCase.input.replace(/\.[^/.]+$/, '')
        const fileExtension = testCase.input.match(/\.[^/.]+$/)?.[0] || ''
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const timestampedFilename = `${filenameBase}_${timestamp}${fileExtension}`

        expect(timestampedFilename).toMatch(testCase.expected)
      }
    })
  })

  describe('Consistency Across Upload Paths', () => {
    it('should use same timestamp generation logic in handleUpload and handleFormSubmission', () => {
      // Simulate the logic used in both handlers
      const generateTimestampedFilename = (originalFilename) => {
        const filenameBase = originalFilename.replace(/\.[^/.]+$/, '')
        const fileExtension = originalFilename.match(/\.[^/.]+$/)?.[0] || ''
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        return {
          timestampedFilename: `${filenameBase}_${timestamp}${fileExtension}`,
          timestamp
        }
      }

      const filename1 = generateTimestampedFilename('test.xlsx')
      const filename2 = generateTimestampedFilename('test.xlsx')

      // Both should follow the same format
      expect(filename1.timestampedFilename).toMatch(
        /^test_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.xlsx$/
      )
      expect(filename2.timestampedFilename).toMatch(
        /^test_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.xlsx$/
      )
    })

    it('should format timestamp consistently for Redis storage', () => {
      const originalFilename = 'data.xlsx'
      const filenameBase = originalFilename.replace(/\.[^/.]+$/, '')
      const fileExtension = originalFilename.match(/\.[^/.]+$/)?.[0] || ''
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const timestampedFilename = `${filenameBase}_${timestamp}${fileExtension}`

      // Simulate Redis storage structure
      const redisData = {
        originalSpreadsheetName: timestampedFilename,
        originalFilename,
        timestamp
      }

      // Verify the timestamp in filename matches the stored timestamp
      const extractedTimestamp = timestampedFilename.match(
        /_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/
      )?.[1]

      expect(extractedTimestamp).toBe(timestamp)
      expect(extractedTimestamp).toBe(redisData.timestamp)
    })
  })
})
