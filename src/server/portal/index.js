import { portalController } from './controller.js'

export const portal = {
  plugin: {
    name: 'portal',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/portal',
          ...portalController
        }
      ])
    }
  }
}
