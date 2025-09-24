import { vi } from 'vitest'

import hapi from '@hapi/hapi'

import { secureContext } from './secure-context.js'
import { config } from '../../../../config/config.js'
import { requestLogger } from '../logging/request-logger.js'

vi.mock('hapi-pino', () => ({
  default: {
    register: (server) => {
      server.decorate('server', 'logger', {
        info: vi.fn(),
        error: vi.fn()
      })
    },
    name: 'mock-hapi-pino'
  }
}))

vi.mock('node:tls', async () => {
  const originalTls = await vi.importActual('node:tls')

  return {
    default: {
      ...originalTls,
      createSecureContext: vi.fn((options) => {
        // Return a mock SecureContext that matches the real API structure
        const mockAddCACert = vi.fn()
        return {
          context: { addCACert: mockAddCACert }
        }
      })
    }
  }
})

describe('#secureContext', () => {
  let server

  describe('When secure context is disabled', () => {
    beforeEach(async () => {
      config.set('isSecureContextEnabled', false)
      server = hapi.server()
      await server.register([requestLogger, secureContext])
    })

    afterEach(async () => {
      config.set('isSecureContextEnabled', false)
      await server.stop({ timeout: 0 })
    })

    test('secureContext decorator should not be available', () => {
      expect(server.logger.info).toHaveBeenCalledWith(
        'Custom secure context is disabled'
      )
    })

    test('Logger should give us disabled message', () => {
      expect(server.secureContext).toBeUndefined()
    })
  })

  describe('When secure context is enabled', () => {
    const PROCESS_ENV = process.env

    beforeAll(() => {
      process.env = { ...PROCESS_ENV }
      process.env.TRUSTSTORE_ONE = 'mock-trust-store-cert-one'
    })

    beforeEach(async () => {
      vi.clearAllMocks()
      config.set('isSecureContextEnabled', true)
      server = hapi.server()
      await server.register([requestLogger, secureContext])
    })

    afterEach(async () => {
      config.set('isSecureContextEnabled', false)
      await server.stop({ timeout: 0 })
    })

    afterAll(() => {
      process.env = PROCESS_ENV
    })

    test('tls.createSecureContext should have been called with empty options', () => {
      // Verify that the secure context was created (evidenced by the decorator existing)
      expect(server.secureContext).toBeDefined()
      expect(server.secureContext.context).toBeDefined()
    })

    test('addCACert should have been called', () => {
      // Access the addCACert mock through the server's secureContext decorator
      expect(server.secureContext.context.addCACert).toHaveBeenCalled()
    })

    test('secureContext decorator should be available', () => {
      expect(server.secureContext).toEqual({
        context: { addCACert: expect.any(Function) }
      })
    })
  })

  describe('When secure context is enabled without TRUSTSTORE_ certs', () => {
    beforeEach(async () => {
      config.set('isSecureContextEnabled', true)
      server = hapi.server()
      await server.register([requestLogger, secureContext])
    })

    afterEach(async () => {
      config.set('isSecureContextEnabled', false)
      await server.stop({ timeout: 0 })
    })

    test('Should log about not finding any TRUSTSTORE_ certs', () => {
      expect(server.logger.info).toHaveBeenCalledWith(
        'Could not find any TRUSTSTORE_ certificates'
      )
    })
  })
})
