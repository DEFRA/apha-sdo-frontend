import { oidcSigninController } from './controller.js'

export const oidcSignin = {
  plugin: {
    name: 'oidc-signin',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/oidc-signin',
          ...oidcSigninController
        }
      ])
    }
  }
}
