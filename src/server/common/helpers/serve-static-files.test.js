import { vi } from 'vitest'
import { startServer } from './start-server.js'
import { statusCodes } from '../constants/status-codes.js'

// Mock Azure Storage to prevent connection errors during server startup
vi.mock('../../services/azure-storage.js', () => ({
  AzureStorageService: vi.fn().mockImplementation(() => ({
    uploadFile: vi.fn().mockResolvedValue({
      blobName: 'test',
      etag: 'test-etag',
      requestId: 'test-request',
      url: 'https://test.blob.core.windows.net/test'
    }),
    downloadFile: vi.fn(),
    deleteFile: vi.fn(),
    listFiles: vi.fn(),
    generateSasUrl: vi.fn()
  }))
}))

// Mock upload plugin to prevent Azure initialization issues
vi.mock('../../upload/index.js', () => ({
  uploadPlugin: {
    plugin: {
      name: 'upload-plugin',
      register: vi.fn()
    }
  }
}))

describe('#serveStaticFiles', () => {
  const PROCESS_ENV = process.env
  let server

  beforeAll(() => {
    // Set test environment variables to prevent Azure/S3 errors
    process.env.AZURE_STORAGE_ENABLED = 'false'
    process.env.S3_ENABLED = 'false'
    process.env.PORT = '3098' // Different port from start-server.test.js
  })

  afterAll(() => {
    process.env = PROCESS_ENV
  })

  describe('When secure context is disabled', () => {
    beforeEach(async () => {
      try {
        server = await startServer()
        if (!server) {
          throw new Error('Server failed to start')
        }
      } catch (error) {
        console.error('Server startup failed:', error)
        throw error
      }
    })

    afterEach(async () => {
      if (server) {
        await server.stop({ timeout: 0 })
        server = null
      }
    })

    test('Should serve favicon as expected', async () => {
      expect(server).toBeDefined()
      expect(typeof server.inject).toBe('function')

      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/favicon.ico'
      })

      expect(statusCode).toBe(statusCodes.noContent)
    })

    test('Should serve assets as expected', async () => {
      expect(server).toBeDefined()
      expect(typeof server.inject).toBe('function')

      // Note npm run build is ran in the postinstall hook in package.json to make sure there is always a file
      // available for this test. Remove as you see fit
      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/public/assets/images/govuk-crest.svg'
      })

      expect(statusCode).toBe(statusCodes.ok)
    })
  })
})
