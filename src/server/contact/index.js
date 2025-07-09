import { contactController } from './controller.js'

export const contact = {
  plugin: {
    name: 'contact',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/contact',
          ...contactController
        }
      ])
    }
  }
}
