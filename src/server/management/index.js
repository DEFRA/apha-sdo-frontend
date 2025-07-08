import { managementController } from './controller.js'

export const management = {
  plugin: {
    name: 'management',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/management',
          ...managementController
        }
      ])
    }
  }
}
