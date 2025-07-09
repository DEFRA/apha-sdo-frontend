import { signoutController } from './controller.js'

export const signout = {
  plugin: {
    name: 'signout',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/signout',
          ...signoutController
        }
      ])
    }
  }
}
