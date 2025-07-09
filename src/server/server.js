import path from 'path'
import hapi from '@hapi/hapi'

import crumb from '@hapi/crumb'
import plugin from '@defra/forms-engine-plugin'

import { router } from './router.js'
import { config } from '../config/config.js'
import { pulse } from './common/helpers/pulse.js'
import { catchAll } from './common/helpers/errors.js'
import { nunjucksConfig } from '../config/nunjucks/nunjucks.js'
import { setupProxy } from './common/helpers/proxy/setup-proxy.js'
import { requestTracing } from './common/helpers/request-tracing.js'
import { requestLogger } from './common/helpers/logging/request-logger.js'
import { sessionCache } from './common/helpers/session-cache/session-cache.js'
import { getCacheEngine } from './common/helpers/session-cache/cache-engine.js'
import { secureContext } from './common/helpers/secure-context/secure-context.js'
import { context } from '../config/nunjucks/context/context.js'

import services from './forms.js'

const { formsService, formSubmissionService, outputService, userService } =
  services

export async function createServer() {
  setupProxy()
  const server = hapi.server({
    host: config.get('host'),
    port: config.get('port'),
    routes: {
      validate: {
        options: {
          abortEarly: false
        }
      },
      files: {
        relativeTo: path.resolve(config.get('root'), '.public')
      },
      security: {
        hsts: {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: false
        },
        xss: 'enabled',
        noSniff: true,
        xframe: true
      }
    },
    router: {
      stripTrailingSlash: true
    },
    cache: [
      {
        name: config.get('session.cache.name'),
        engine: getCacheEngine(config.get('session.cache.engine'))
      }
    ],
    state: {
      strictHeader: false
    }
  })
  await server.register([
    crumb,
    requestLogger,
    requestTracing,
    secureContext,
    pulse,
    sessionCache,
    nunjucksConfig,
    router // Register all the controllers/routes defined in src/server/router.js
  ])

  // Register the `forms-engine-plugin`
  await server.register({
    plugin,
    options: {
      cacheName: 'session', // must match a session you've instantiated in your hapi server config
      /**
       * Options that DXT uses to render Nunjucks templates
       */
      nunjucks: {
        baseLayoutPath: 'layouts/page.njk', // the base page layout. Usually based off https://design-system.service.gov.uk/styles/page-template/
        paths: [
          path.resolve(config.get('root'), 'src/server/common/templates'),
          path.resolve(config.get('root'), 'src/server/common/components')
        ] // list of directories DXT should use to render your views. Must contain baseLayoutPath.
      },
      /**
       * Services is what DXT uses to interact with external APIs
       */
      services: {
        formsService, // where your forms should be downloaded from.
        formSubmissionService, // handles temporary storage of file uploads
        outputService // where your form should be submitted to
      },
      /**
       * File upload configuration
       */
      upload: {
        maxBytes: 10485760, // 10MB
        timeout: 60000, // 60 seconds
        output: 'stream'
      },
      /**
       * View context attributes made available to your pages. Returns an object containing an arbitrary set of key-value pairs.
       */
      viewContext: async (request) => {
        // async can be dropped if there's no async code within
        const user = await userService.getUser(request.auth.credentials)
        const pageContext = context(request)

        return {
          greeting: 'Hello', // available to render on a nunjucks page as {{ greeting }}
          username: user.username, // available to render on a nunjucks page as {{ username }}
          // Add context variables required by page.njk
          ...pageContext
        }
      }
    }
  })

  server.ext('onPreResponse', catchAll)

  return server
}
