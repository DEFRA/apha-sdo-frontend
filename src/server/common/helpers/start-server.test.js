import { vi } from 'vitest'

const mockLoggerInfo = vi.fn()
const mockLoggerError = vi.fn()

const mockHapiLoggerInfo = vi.fn()
const mockHapiLoggerError = vi.fn()

// Mock server object
const mockServer = {
  start: vi.fn(),
  stop: vi.fn(),
  logger: {
    info: mockHapiLoggerInfo,
    error: mockHapiLoggerError
  }
}

// Mock createServer function
const mockCreateServer = vi.fn()

// Mock the server module
vi.mock('../../server.js', () => ({
  createServer: mockCreateServer
}))

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
  logger: {
    info: (...args) => mockLoggerInfo(...args),
    error: (...args) => mockLoggerError(...args)
  },
  createLogger: () => ({
    info: (...args) => mockLoggerInfo(...args),
    error: (...args) => mockLoggerError(...args)
  })
}))

describe('#startServer', () => {
  const PROCESS_ENV = process.env
  let startServerImport

  beforeAll(async () => {
    process.env = { ...PROCESS_ENV }
    process.env.PORT = '3097' // Set to obscure port to avoid conflicts

    startServerImport = await import('./start-server.js')
  })

  afterAll(() => {
    process.env = PROCESS_ENV
  })

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks()
  })

  describe('When server starts', () => {
    beforeEach(() => {
      // Setup successful server creation
      mockCreateServer.mockResolvedValue(mockServer)
      mockServer.start.mockResolvedValue()
    })

    test('Should start up server as expected', async () => {
      const server = await startServerImport.startServer()

      expect(mockCreateServer).toHaveBeenCalled()
      expect(mockServer.start).toHaveBeenCalled()
      expect(mockHapiLoggerInfo).toHaveBeenCalledWith(
        'Server started successfully'
      )
      expect(mockHapiLoggerInfo).toHaveBeenCalledWith(
        'Access your frontend on http://localhost:3097'
      )
      expect(server).toBe(mockServer)
    })
  })

  describe('When server start fails', () => {
    beforeEach(() => {
      // Setup server creation failure
      mockCreateServer.mockRejectedValue(new Error('Server failed to start'))
    })

    test('Should log failed startup message', async () => {
      const server = await startServerImport.startServer()

      expect(mockLoggerInfo).toHaveBeenCalledWith('Server failed to start :(')
      expect(mockLoggerError).toHaveBeenCalledWith(
        new Error('Server failed to start')
      )
      expect(server).toBeUndefined()
    })
  })
})
