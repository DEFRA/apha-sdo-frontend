import { config } from '../../../config/config.js'
import { statusCodes } from '../constants/status-codes.js'

const options = {
  auth: false,
  cache: {
    expiresIn: config.get('staticCacheTimeout'),
    privacy: 'private'
  }
}

export const serveStaticFiles = {
  plugin: {
    name: 'staticFiles',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/stylesheets/application.min.css',
          handler: {
            file: './stylesheets/dxt-application.min.css'
          },
          options
        },
        {
          method: 'GET',
          path: '/javascripts/application.min.js',
          handler(request, h) {
            return h
              .file('./javascripts/dxt-shared.min.js')
              .type('application/javascript')
          },
          options
        },
        {
          method: 'GET',
          path: '/assets/{path*}',
          handler: {
            directory: {
              path: './dxt-assets/'
            }
          },
          options
        },
        {
          method: 'GET',
          path: '/favicon.ico',
          handler(_request, h) {
            return h.response().code(statusCodes.noContent).type('image/x-icon')
          }
        },
        {
          options: {
            auth: false,
            cache: {
              expiresIn: config.get('staticCacheTimeout'),
              privacy: 'private'
            }
          },
          method: 'GET',
          path: `${config.get('assetPath')}/{param*}`,
          handler: {
            directory: {
              path: '.',
              redirectToSlash: true
            }
          }
        }
      ])
    }
  }
}
