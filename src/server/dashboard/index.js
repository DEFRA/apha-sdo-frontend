import { dashboardController } from './controller.js'

export const dashboard = {
  plugin: {
    name: 'dashboard',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/dashboard',
          ...dashboardController
        }
      ])
    }
  }
}
