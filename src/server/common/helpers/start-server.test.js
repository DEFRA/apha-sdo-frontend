import { vi } from 'vitest'

import hapi from '@hapi/hapi'

const mockLoggerInfo = vi.fn()
const mockLoggerError = vi.fn()

const mockHapiLoggerInfo = vi.fn()
const mockHapiLoggerError = vi.fn()

vi.mock('hapi-pino', () => ({
  default: {
    register: (server) => {
      server.decorate('server', 'logger', {
        info: mockHapiLoggerInfo,
        error: mockHapiLoggerError
      })
    },
    name: 'hapi-pino'
  }
}))

vi.mock('./logging/logger.js', () => ({
  createLogger: () => ({
    info: (...args) => mockLoggerInfo(...args),
    error: (...args) => mockLoggerError(...args)
  })
}))

// Mock Azure Storage to prevent connection errors
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

describe('#startServer', () => {
  const PROCESS_ENV = process.env
  let createServerSpy
  let hapiServerSpy
  let startServerImport
  let createServerImport

  beforeAll(async () => {
    process.env = { ...PROCESS_ENV }
    process.env.PORT = '3097' // Set to obscure port to avoid conflicts
    process.env.AZURE_STORAGE_ENABLED = 'false' // Disable Azure for tests
    process.env.S3_ENABLED = 'false' // Disable S3 for tests

    createServerImport = await import('../../server.js')
    startServerImport = await import('./start-server.js')

    createServerSpy = vi.spyOn(createServerImport, 'createServer')
    hapiServerSpy = vi.spyOn(hapi, 'server')
  })

  afterAll(() => {
    process.env = PROCESS_ENV
    vi.clearAllMocks()
  })

  describe('When server starts', () => {
    let server

    afterAll(async () => {
      if (server) {
        await server.stop({ timeout: 0 })
      }
    })

    test('Should start up server as expected', async () => {
      server = await startServerImport.startServer()

      expect(server).toBeDefined()
      expect(createServerSpy).toHaveBeenCalled()
      expect(hapiServerSpy).toHaveBeenCalled()
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'Using Catbox Memory session cache'
      )
      expect(mockHapiLoggerInfo).toHaveBeenCalledWith(
        'Custom secure context is disabled'
      )
      expect(mockHapiLoggerInfo).toHaveBeenCalledWith(
        'Server started successfully'
      )
      expect(mockHapiLoggerInfo).toHaveBeenCalledWith(
        'Access your frontend on http://localhost:3097'
      )
    })
  })

  describe('When server start fails', () => {
    beforeAll(() => {
      createServerSpy.mockRejectedValue(new Error('Server failed to start'))
    })

    afterAll(() => {
      createServerSpy.mockRestore()
    })

    test('Should log failed startup message', async () => {
      const server = await startServerImport.startServer()

      expect(server).toBeUndefined()
      expect(mockLoggerInfo).toHaveBeenCalledWith('Server failed to start :(')
      expect(mockLoggerError).toHaveBeenCalledWith(
        Error('Server failed to start')
      )
    })
  })
})
