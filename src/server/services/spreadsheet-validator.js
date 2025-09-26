import XLSX from 'xlsx'
import csv from 'csv-parser'
import { lookup } from 'mime-types'
import { Readable } from 'node:stream'
import { config } from '../../config/config.js'

class SpreadsheetValidator {
  constructor() {
    this.allowedMimeTypes = config.get('storage.allowedMimeTypes')
    this.maxFileSize = config.get('storage.maxFileSize')
  }

  validateFile(file) {
    const errors = []
    if (file.size > this.maxFileSize) {
      errors.push(
        `File size ${Math.round(file.size / 1024 / 1024)}MB exceeds limit of ${Math.round(this.maxFileSize / 1024 / 1024)}MB`
      )
    }

    const mimeType =
      file.mimetype || lookup(file.originalname) || 'application/octet-stream'
    if (!this.allowedMimeTypes.includes(mimeType)) {
      errors.push(
        `File type ${mimeType} is not allowed. Supported types: .xlsx, .xls, .csv`
      )
    }

    const extension = file.originalname.toLowerCase().split('.').pop()
    const validExtensions = ['xlsx', 'xls', 'csv']
    if (!validExtensions.includes(extension)) {
      errors.push(`File extension .${extension} is not supported`)
    }

    return {
      isValid: errors.length === 0,
      errors,
      fileInfo: {
        originalName: file.originalname,
        size: file.size,
        mimeType,
        extension
      }
    }
  }

  async validateSpreadsheetContent(buffer, filename) {
    try {
      const extension = filename.toLowerCase().split('.').pop()

      switch (extension) {
        case 'xlsx':
        case 'xls':
          return await this.validateExcelContent(buffer)
        case 'csv':
          return await this.validateCsvContent(buffer)
        default:
          throw new Error(`Unsupported file type: ${extension}`)
      }
    } catch (error) {
      const extension = filename.toLowerCase().split('.').pop()
      return {
        isValid: false,
        errors: [
          `Failed to parse ${extension.toUpperCase()} file: ${error.message}`
        ],
        sheets: []
      }
    }
  }

  async validateExcelContent(buffer) {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' })
      const sheets = []
      const errors = []

      if (workbook.SheetNames.length === 0) {
        errors.push('Excel file contains no sheets')
        return { isValid: false, errors, sheets }
      }

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName]
        const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1')

        const sheetData = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: '',
          raw: false
        })

        const nonEmptyRows = sheetData.filter((row) =>
          row.some((cell) => cell && cell.toString().trim() !== '')
        )

        if (nonEmptyRows.length === 0) {
          errors.push(`Sheet "${sheetName}" is empty`)
        }

        sheets.push({
          name: sheetName,
          rowCount: nonEmptyRows.length,
          columnCount: range.e.c + 1,
          hasHeaders:
            nonEmptyRows.length > 0 &&
            nonEmptyRows[0].some(
              (cell) => cell && typeof cell === 'string' && cell.trim() !== ''
            ),
          preview: nonEmptyRows
            .slice(0, 5)
            .map((row) =>
              row.slice(0, 10).map((cell) => cell?.toString() || '')
            )
        })
      }

      return {
        isValid: errors.length === 0,
        errors,
        sheets
      }
    } catch (error) {
      return {
        isValid: false,
        errors: [`Invalid Excel file: ${error.message}`],
        sheets: []
      }
    }
  }

  async validateCsvContent(buffer) {
    return new Promise((resolve) => {
      const rows = []
      const errors = []
      let rowCount = 0
      let columnCount = 0

      const stream = Readable.from(buffer.toString())

      stream
        .pipe(csv({ skipEmptyLines: true }))
        .on('data', (data) => {
          if (rowCount === 0) {
            columnCount = Object.keys(data).length
          }
          if (rowCount < 5) {
            rows.push(Object.values(data).map((val) => val?.toString() || ''))
          }
          rowCount++
        })
        .on('end', () => {
          if (rowCount === 0) {
            errors.push('CSV file is empty')
          }

          resolve({
            isValid: errors.length === 0,
            errors,
            sheets: [
              {
                name: 'CSV Data',
                rowCount,
                columnCount,
                hasHeaders:
                  rows.length > 0 &&
                  rows[0].some(
                    (cell) =>
                      cell && typeof cell === 'string' && cell.trim() !== ''
                  ),
                preview: rows
              }
            ]
          })
        })
        .on('error', (error) => {
          resolve({
            isValid: false,
            errors: [`Invalid CSV file: ${error.message}`],
            sheets: []
          })
        })
    })
  }

  generateValidationReport(validation) {
    return {
      timestamp: new Date().toISOString(),
      isValid: validation.isValid,
      errors: validation.errors,
      fileInfo: validation.fileInfo,
      sheets:
        validation.sheets?.map((sheet) => ({
          name: sheet.name,
          rowCount: sheet.rowCount,
          columnCount: sheet.columnCount,
          hasHeaders: sheet.hasHeaders
        })) || []
    }
  }
}

export { SpreadsheetValidator }
